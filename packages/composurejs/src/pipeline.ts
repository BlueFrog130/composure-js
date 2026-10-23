// The request pipeline every platform shares (ADR 0007). An entry only maps a platform call to it.
import type {
  APIApplicationCommandAutocompleteInteraction,
  APIApplicationCommandInteractionDataBasicOption,
  APIApplicationCommandInteractionDataOption,
  APIApplicationCommandInteraction,
  APIInteractionDataResolved,
  APIMessage,
} from "discord-api-types/v10";
import { type App, type Built, internals } from "./app.ts";
import type { AnyCommand, AutoDeferSetting, Command, Group } from "./command.ts";
import { Context, ROUTE } from "./context.ts";
import type { Credentials } from "./credentials.ts";
import { type Interaction, type InteractionResponse, InteractionType, MessageFlags, ResponseType } from "./discord.ts";
import { FAIL, prefixOf, splitRoute } from "./codec.ts";
import { DiscordApiError, InvalidOptionsError, ResponseError, UnknownCommandError, UserError } from "./errors.ts";
import { decodeEvent, EventContext } from "./events.ts";
import { dispatchHandler } from "./handlers.ts";
import { isNode } from "./jsx/node.ts";
import { type Logger, serializeError, withFields } from "./log.ts";
import { runChain } from "./middleware.ts";
import { type Choice, OptionType, resolveOptions, resolveUser } from "./options.ts";
import { LIMITS } from "./jsx/render.ts";
import { type Answer, type Deferred, Ephemeral, isDeferred, type Output, rerendered, toAnswer, unwrapEphemeral, unwrapReply } from "./response.ts";
import type { RestOptions } from "./rest/client.ts";
import { InteractionClient } from "./rest/interaction.ts";
import { messageBody, toMessageBody } from "./rest/message.ts";
import type { Transport } from "./transport.ts";
import type { BindingsOf, DataOf, Env, Platform } from "./types.ts";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "./verify.ts";

/** Largest accepted request body; larger ones are answered 413. */
export const MAX_BODY_BYTES = 1024 * 1024;

export const GENERIC_ERROR_MESSAGE = "Something went wrong.";
export const OUTDATED_MESSAGE = "This message is outdated.";

const decoder = new TextDecoder();

const NO_CHOICES: InteractionResponse = { type: ResponseType.ApplicationCommandAutocompleteResult, data: { choices: [] } };

export interface HandleOptions<E extends Env> {
  credentials: Credentials;
  env: BindingsOf<E>;
  data: DataOf<E>;
  platform?: Platform | undefined;
  /** Overrides the App's Transport. */
  transport?: Transport | undefined;
  /** When the request arrived (ms since the epoch), for Auto Defer's threshold. Default: now. */
  receivedAt?: number | undefined;
}

/**
 * Answers one HTTP request carrying an Interaction (or, at the events path, a Webhook Event),
 * with Credentials and Bot Data already loaded. `app.fetch` loads them and calls this; use it
 * for custom routing.
 */
export async function handleInteraction<E extends Env>(app: App<E>, request: Request, options: HandleOptions<E>): Promise<Response> {
  const built = internals(app).build();
  if (new URL(request.url).pathname === built.eventsPath) return handleEvent(app, request, options);
  const read = await readSigned(built, request, options.credentials);
  if (read instanceof Response) return read;
  const interaction = read;
  if (!isInteraction(interaction)) return notAnInteraction();

  const log = interaction.type === InteractionType.Ping ? built.logger : withFields(built.logger, logFields(interaction));
  const rest = restOptions(built, options, log);
  const answering = answerInteraction(built, interaction, options, rest, log);
  const auto = autoDeferOf(built, interaction, options.receivedAt ?? Date.now());
  const first = auto ? await raceTimer(answering, auto.wait) : await answering;
  if (first === TIMED_OUT) return autoDeferred(built, interaction, answering, auto!.sent, options, rest, log);
  const { answer, c } = first;
  const client = () => c?.client ?? new InteractionClient(interaction.application_id, interaction.id, interaction.token, rest);

  if (answer.files.length > 0) return sendThroughCallback(log, interaction, answer, client());
  if (answer.deferred && c) {
    const work = runDeferred(built, c, answer.deferred);
    if (options.platform?.waitUntil) {
      options.platform.waitUntil(work);
      return Response.json(answer.response);
    }
    // No waitUntil (AWS Lambda, an untracked server): answer through the callback endpoint,
    // finish the work, then answer the HTTP request with 202 (ADR 0007).
    const sent = await sendThroughCallback(log, interaction, answer, client());
    if (sent.status === 202) await work;
    return sent;
  }
  return Response.json(answer.response);
}

/** What an Auto Defer sends: a loading reply (type 5, maybe ephemeral) or an acknowledged update (type 6). */
interface Sent {
  kind: "message" | "update";
  ephemeral: boolean;
}

const TIMED_OUT = Symbol("composurejs.timedOut");
const AUTO_DEFER_PUBLIC = 'A public Auto Defer was answered ephemerally; set autoDefer: "ephemeral" on the Command';

async function raceTimer<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => (timer = setTimeout(resolve, ms, TIMED_OUT)));
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether this Interaction gets Auto Defer, how long to wait, and what deferring sends (ADR 0027).
 * Commands, clicks and modal submits; never Ping or autocomplete, which cannot be deferred.
 */
function autoDeferOf<E extends Env>(built: Built<E>, interaction: Interaction, receivedAt: number): { wait: number; sent: Sent } | undefined {
  if (built.autoDeferAfter === undefined) return undefined;
  let setting: AutoDeferSetting | undefined;
  let kind: Sent["kind"];
  switch (interaction.type) {
    case InteractionType.ApplicationCommand: {
      const command = built.commands.get(`${interaction.data.type}:${interaction.data.name}`)?.command;
      const leaf = command?.kind === "group" ? findLeaf(command, (interaction.data as CommandData).options)?.leaf : undefined;
      setting = leaf?.autoDefer ?? command?.autoDefer;
      kind = "message";
      break;
    }
    case InteractionType.MessageComponent:
    case InteractionType.ModalSubmit: {
      const { route } = splitRoute(interaction.data.custom_id);
      setting = route === undefined ? undefined : built.routes.get(route)?.command.autoDefer;
      kind = interaction.type === InteractionType.MessageComponent || ("message" in interaction && interaction.message !== undefined) ? "update" : "message";
      break;
    }
    default:
      return undefined;
  }
  if (setting === false) return undefined;
  return { wait: Math.max(0, built.autoDeferAfter - (Date.now() - receivedAt)), sent: { kind, ephemeral: kind === "message" && setting === "ephemeral" } };
}

/**
 * The handler is still running past the threshold: answer with the deferral now, and deliver its
 * answer as Background Work once it has one (ADR 0027).
 */
async function autoDeferred<E extends Env>(
  built: Built<E>,
  interaction: Interaction,
  answering: Promise<{ answer: Answer; c?: Context<E> }>,
  sent: Sent,
  options: HandleOptions<E>,
  rest: RestOptions,
  log: Logger,
): Promise<Response> {
  const response: InteractionResponse =
    sent.kind === "update"
      ? { type: ResponseType.DeferredMessageUpdate }
      : { type: ResponseType.DeferredChannelMessageWithSource, ...(sent.ephemeral && { data: { flags: MessageFlags.Ephemeral } }) };
  log.debug({ msg: "Auto Defer", kind: sent.kind });
  const work = (async () => {
    const { answer, c } = await answering;
    if (!c) return;
    if (answer.deferred) return runDeferred(built, c, answer.deferred, sent);
    try {
      await deliver(c, answer, sent);
    } catch (error) {
      await reportFailure(built, c, error, sent);
    }
  })().catch((error: unknown) => log.error({ msg: "Answering after Auto Defer failed", error: serializeError(error) }));
  if (options.platform?.waitUntil) {
    options.platform.waitUntil(work);
    return Response.json(response);
  }
  const client = new InteractionClient(interaction.application_id, interaction.id, interaction.token, rest);
  const answered = await sendThroughCallback(log, interaction, { response, files: [] }, client);
  if (answered.status === 202) await work;
  return answered;
}

/** Delivers an answer rendered after its Interaction was deferred: edits the original, or follows up. */
async function deliver<E extends Env>(c: Context<E>, answer: Answer, sent: Sent): Promise<void> {
  const { response, files } = answer;
  const data: Record<string, unknown> = { ...(response as { data?: Record<string, unknown> }).data };
  const flags = (data.flags as number | undefined) ?? 0;
  switch (response.type) {
    case ResponseType.ChannelMessageWithSource: {
      const ephemeral = (flags & MessageFlags.Ephemeral) !== 0;
      // A new message from a click (c.reply): the clicked message stays as it is.
      if (sent.kind === "update") return void (await c.client.followup(messageBody(data, files)));
      if (ephemeral && !sent.ephemeral) {
        // Discord fixed the loading reply as public; a private answer replaces it.
        c.log.warn({ msg: AUTO_DEFER_PUBLIC });
        await c.client.deleteOriginal();
        return void (await c.client.followup(messageBody(data, files)));
      }
      // Edits cannot change ephemerality: the loading reply already fixed it.
      const kept = flags & ~MessageFlags.Ephemeral;
      if (kept) data.flags = kept;
      else delete data.flags;
      return void (await c.client.editOriginal(messageBody(data, files)));
    }
    case ResponseType.UpdateMessage:
      return void (await c.client.editOriginal(messageBody(data, files)));
    case ResponseType.Modal:
      throw new ResponseError("A modal cannot open after Auto Defer deferred the Interaction: open it before other slow work, or set autoDefer: false");
  }
  throw new ResponseError(`An answer of type ${response.type} cannot follow Auto Defer`);
}

/** The Error Renderer's output for work that failed after deferring: edits the loading reply, else an ephemeral follow-up. */
async function reportFailure<E extends Env>(built: Built<E>, c: Context<E>, error: unknown, sent: Sent): Promise<void> {
  try {
    const [output] = unwrapEphemeral(await errorOutput(built, error, c));
    if (sent.kind === "update") await c.client.followup(Ephemeral(output));
    else await c.client.editOriginal(await toMessageBody(output as never, { route: c[ROUTE] }));
  } catch (reportError) {
    c.log.error({ msg: "Reporting failed deferred work failed", error: serializeError(reportError) });
  }
}

function restOptions<E extends Env>(built: Built<E>, options: HandleOptions<E>, logger: Logger): RestOptions {
  return { transport: options.transport ?? built.transport, logger, maxRateLimitWait: built.maxRateLimitWait, timeout: built.requestTimeout };
}

/** Verifies and parses a signed request; a Response when it must be rejected. */
async function readSigned<E extends Env>(built: Built<E>, request: Request, credentials: Credentials): Promise<unknown> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge();
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) return tooLarge();
  const verified = await verifySignature(credentials.publicKey, request.headers.get(SIGNATURE_HEADER), request.headers.get(TIMESTAMP_HEADER), body, {
    maxAge: built.maxSignatureAge,
  });
  if (!verified) return new Response("Invalid request signature", { status: 401 });
  try {
    return JSON.parse(decoder.decode(body)) as unknown;
  } catch {
    return notAnInteraction();
  }
}

/**
 * Answers a Webhook Event request: 204 at once, the App's Event Handler as Background Work.
 * Without a platform waitUntil the handler runs before the 204, within Discord's 3 seconds.
 */
export async function handleEvent<E extends Env>(app: App<E>, request: Request, options: HandleOptions<E>): Promise<Response> {
  const built = internals(app).build();
  const body = await readSigned(built, request, options.credentials);
  if (body instanceof Response) return body;
  if (typeof body !== "object" || body === null || typeof (body as { type?: unknown }).type !== "number") return new Response("Not a webhook event", { status: 400 });
  const { type, event } = body as { type: number; event?: unknown };
  const ack = new Response(null, { status: 204 });
  // 0 is Discord's PING; types this version does not know are ACKed and ignored.
  if (type !== 1 || !built.events) return ack;

  const decoded = decodeEvent(event);
  const log = withFields(built.logger, { event: decoded.type });
  const c = new EventContext<E>({
    env: options.env,
    data: options.data,
    platform: options.platform,
    logger: log,
    credentials: options.credentials,
    rest: restOptions(built, options, log),
  });
  const handler = built.events;
  const work = (async () => {
    try {
      await handler(c, decoded);
    } catch (error) {
      // Only logged: the event is already ACKed.
      log.error({ msg: "Event Handler failed", error: serializeError(error) });
    }
  })();
  if (options.platform?.waitUntil) options.platform.waitUntil(work);
  else await work;
  return ack;
}

/**
 * Answers through the callback endpoint (multipart when there are files), then answers the
 * HTTP request with 202. If Discord rejects it, the Interaction is still unanswered, so the
 * HTTP response carries the generic error instead.
 */
async function sendThroughCallback(log: Logger, interaction: Interaction, answer: Answer, client: InteractionClient): Promise<Response> {
  try {
    await client.callback(answer.response, answer.files);
    return new Response(null, { status: 202 });
  } catch (error) {
    // DiscordApiError names the route template, never the URL: it holds the Interaction token.
    const detail = error instanceof DiscordApiError ? { status: error.status, code: error.code, route: error.route, errors: error.errors } : { error: serializeError(error) };
    log.error({ msg: "Answering through the callback endpoint failed", ...detail });
    return Response.json((await toAnswer(Ephemeral(GENERIC_ERROR_MESSAGE), interaction.type)).response);
  }
}

async function answerInteraction<E extends Env>(
  built: Built<E>,
  interaction: Interaction,
  options: HandleOptions<E>,
  rest: RestOptions,
  log: Logger,
): Promise<{ answer: Answer; c?: Context<E> }> {
  if (interaction.type === InteractionType.Ping) return { answer: { response: { type: ResponseType.Pong }, files: [] } };

  const c = new Context<E>({
    interaction,
    env: options.env,
    data: options.data,
    platform: options.platform,
    logger: log,
    credentials: options.credentials,
    rest,
  });
  try {
    return { answer: await toAnswer(await dispatch(built, c), interaction.type, c[ROUTE]), c };
  } catch (error) {
    if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
      // A message is no answer to autocomplete; the user sees no suggestions.
      log.error({ msg: "Autocomplete failed", error: serializeError(error) });
      return { answer: { response: NO_CHOICES, files: [] }, c };
    }
    return { answer: await renderError(built, error, c), c };
  }
}

/**
 * Background Work of a Deferred Response: run the work, then edit the original (the deferred
 * reply, or the component's message for deferUpdate). On failure the Error Renderer's output
 * edits the original, or for deferUpdate goes out as an ephemeral follow-up, so the component's
 * message keeps its state (composure-rs ADR 0006). `sent` is what Discord was answered with, which
 * differs from what the work asked for when Auto Defer answered first (ADR 0027).
 */
async function runDeferred<E extends Env>(built: Built<E>, c: Context<E>, deferred: Deferred, sent: Sent = deferred): Promise<void> {
  try {
    const [output, ephemeral] = unwrapEphemeral(await deferred.run());
    if (ephemeral && !deferred.ephemeral) {
      throw new ResponseError("Ephemerality is decided when deferring, as Discord fixes it then: c.defer(work, { ephemeral: true })");
    }
    if (isDeferred(output)) throw new ResponseError("Deferred work cannot defer again");
    const body = await toMessageBody(output, { route: c[ROUTE] });
    if (sent.kind === "update" && deferred.kind === "message") {
      // c.defer from a click after Auto Defer acknowledged it as an update: the answer is a new message.
      await c.client.followup(
        deferred.ephemeral ? messageBody({ ...body.json, flags: ((body.json.flags as number | undefined) ?? 0) | MessageFlags.Ephemeral }, body.files) : body,
      );
    } else if (deferred.ephemeral && !sent.ephemeral && sent.kind === "message") {
      c.log.warn({ msg: AUTO_DEFER_PUBLIC });
      await c.client.deleteOriginal();
      await c.client.followup(messageBody({ ...body.json, flags: ((body.json.flags as number | undefined) ?? 0) | MessageFlags.Ephemeral }, body.files));
    } else await c.client.editOriginal(body);
  } catch (error) {
    await reportFailure(built, c, error, sent);
  }
}

function dispatch<E extends Env>(built: Built<E>, c: Context<E>): Promise<Output> {
  const interaction = c.interaction;
  switch (interaction.type) {
    case InteractionType.ApplicationCommand: {
      const entry = built.commands.get(`${interaction.data.type}:${interaction.data.name}`);
      if (!entry) {
        return runChain(built.middleware, c, () => {
          throw new UnknownCommandError(interaction.data.name);
        });
      }
      c[ROUTE] = entry.route;
      return runChain(entry.chain, c, () => invokeCommand(entry.command, c as Context<E, APIApplicationCommandInteraction>));
    }
    case InteractionType.ApplicationCommandAutocomplete: {
      const entry = built.commands.get(`${interaction.data.type}:${interaction.data.name}`);
      return runChain(entry?.chain ?? built.middleware, c, () => (entry ? autocomplete(entry.command, c as Context<E, APIApplicationCommandAutocompleteInteraction>) : NO_CHOICES));
    }
    case InteractionType.MessageComponent:
    case InteractionType.ModalSubmit: {
      // A click runs the middleware of the Command that rendered the handler, its Owning Route
      // (ADR 0026); one that no longer exists gets the Fallback, never a shorter chain.
      const { route, customId } = splitRoute(interaction.data.custom_id);
      const entry = route === undefined ? undefined : built.routes.get(route);
      if (entry) c[ROUTE] = entry.route;
      return runChain(entry?.chain ?? built.middleware, c, async () => {
        const output = route !== undefined && !entry ? FAIL : await dispatchHandler(c, customId);
        if (output === FAIL) {
          // An unknown handler id or route, or captures that no longer decode: the Fallback (ADR 0015).
          c.log.debug({ msg: "Fallback" });
          return Ephemeral(OUTDATED_MESSAGE);
        }
        return rerender(output, interaction);
      });
    }
    default:
      // A kind this version does not know (ADR 0003): answer, never crash.
      c.log.warn({ msg: "Unknown interaction type" });
      return runChain(built.middleware, c, () => Ephemeral(GENERIC_ERROR_MESSAGE));
  }
}

/** Command data of any command type, read field by field. */
interface CommandData {
  options?: APIApplicationCommandInteractionDataOption[];
  resolved?: APIInteractionDataResolved & { messages?: Record<string, APIMessage> };
  target_id?: string;
}

/**
 * Markup returned from a click (or from a modal opened by one) updates that message; `c.reply(..)`
 * and `c.ephemeral(..)` answer with a new one, as does anything answering a modal opened by a Command.
 */
function rerender(output: Output, interaction: Interaction): Output {
  const [inner, reply] = unwrapReply(output);
  if (reply) return inner;
  const fromMessage =
    interaction.type === InteractionType.MessageComponent || (interaction.type === InteractionType.ModalSubmit && "message" in interaction && interaction.message !== undefined);
  return fromMessage && (isNode(output) || output instanceof Promise) ? rerendered(output) : output;
}

function invokeCommand<E extends Env>(command: AnyCommand<E>, c: Context<E, APIApplicationCommandInteraction>) {
  const data = c.interaction.data as CommandData;
  switch (command.kind) {
    case "command":
    case "group": {
      const found = findLeaf(command, data.options);
      if (!found) throw new InvalidOptionsError(`No subcommand of "/${command.name}" matches the Interaction`);
      return found.leaf.handler(c as never, resolveOptions(found.leaf.options, found.options, data.resolved) as never);
    }
    case "user": {
      const target = data.target_id ? resolveUser(data.target_id, data.resolved) : undefined;
      if (!target) throw new InvalidOptionsError(`User Command "${command.name}" has no resolved target user`);
      return command.handler(c as never, target);
    }
    case "message": {
      const target = data.target_id ? data.resolved?.messages?.[data.target_id] : undefined;
      if (!target) throw new InvalidOptionsError(`Message Command "${command.name}" has no resolved target message`);
      return command.handler(c as never, target);
    }
  }
}

interface Leaf<E extends Env> {
  leaf: Command<E>;
  options: APIApplicationCommandInteractionDataBasicOption[] | undefined;
}

/** The Command a Group's Interaction addresses, with that Command's raw Options. */
function findLeaf<E extends Env>(command: Command<E> | Group<E>, options: APIApplicationCommandInteractionDataOption[] | undefined): Leaf<E> | undefined {
  if (command.kind === "command") return { leaf: command, options: options as APIApplicationCommandInteractionDataBasicOption[] | undefined };
  const first = options?.[0];
  const sub = first && command.subcommands.find((s) => s.name === first.name);
  if (!first || !sub) return undefined;
  if (first.type === OptionType.SubcommandGroup && sub.kind === "group") return findLeaf(sub, first.options);
  if (first.type === OptionType.Subcommand && sub.kind === "command") return { leaf: sub, options: first.options };
  return undefined;
}

async function autocomplete<E extends Env>(command: AnyCommand<E>, c: Context<E, APIApplicationCommandAutocompleteInteraction>): Promise<Output> {
  if (command.kind !== "command" && command.kind !== "group") return NO_CHOICES;
  const found = findLeaf(command, c.interaction.data.options as APIApplicationCommandInteractionDataOption[]);
  const focused = found?.options?.find((o) => "focused" in o && o.focused);
  const handler = found && focused && found.leaf.options[focused.name]?.spec.autocomplete;
  if (!found || !focused || !handler || !("value" in focused)) return NO_CHOICES;

  const others: Record<string, string | number | boolean> = {};
  for (const o of found.options ?? []) if (o !== focused && "value" in o) others[o.name] = o.value;
  const results = await handler(c as never, String(focused.value), others);
  return { type: ResponseType.ApplicationCommandAutocompleteResult, data: { choices: suggestions(c, results) } };
}

/**
 * Discord rejects the whole answer for one bad Choice, and the user would see no suggestions
 * without knowing why: over-long names are cut, empty names and over-long values are dropped
 * (logged), and the first 25 are kept.
 */
function suggestions<E extends Env>(c: Context<E>, results: readonly (Choice | string | number)[]): Choice[] {
  const out: Choice[] = [];
  for (const r of results) {
    if (out.length === LIMITS.selectOptions) break;
    const { name, value } = typeof r === "object" ? r : { name: String(r), value: r };
    if (name === "" || (typeof value === "string" && (value === "" || value.length > LIMITS.optionText))) {
      c.log.warn({ msg: "Autocomplete Choice dropped: names and string values must be 1-100 characters", name: name.slice(0, 40) });
      continue;
    }
    out.push({ name: name.length > LIMITS.optionText ? `${name.slice(0, LIMITS.optionText - 1)}…` : name, value });
  }
  return out;
}

/** The Error Renderer's output, ephemeral; logs every error except User Errors. */
async function renderError<E extends Env>(built: Built<E>, error: unknown, c: Context<E>): Promise<Answer> {
  const output = await errorOutput(built, error, c);
  try {
    return await toAnswer(Ephemeral(unwrapEphemeral(output)[0]), c.interaction.type, c[ROUTE]);
  } catch (rendererError) {
    c.log.error({ msg: "Error Renderer failed", error: serializeError(rendererError) });
    return toAnswer(Ephemeral(defaultErrorOutput(error)), c.interaction.type);
  }
}

/** Logs `error` (User Errors at debug) and asks the Error Renderer what the user sees. */
async function errorOutput<E extends Env>(built: Built<E>, error: unknown, c: Context<E>): Promise<Output> {
  const entry = { error: serializeError(error) };
  if (error instanceof UserError) c.log.debug({ msg: "User Error", ...entry });
  else if (error instanceof UnknownCommandError) c.log.warn({ msg: "Unknown Command", ...entry });
  else if (error instanceof InvalidOptionsError) c.log.warn({ msg: "Invalid Options", ...entry });
  else c.log.error({ msg: "Handler failed", ...entry });
  try {
    return built.onError ? await built.onError(error, c) : defaultErrorOutput(error);
  } catch (rendererError) {
    c.log.error({ msg: "Error Renderer failed", error: serializeError(rendererError) });
    return defaultErrorOutput(error);
  }
}

/** What the user sees without an Error Renderer: a User Error's message, else a generic one. */
export function defaultErrorOutput(error: unknown): string {
  return error instanceof UserError ? error.message : GENERIC_ERROR_MESSAGE;
}

/**
 * What every entry logged while answering an Interaction carries: its id and type, the Command or
 * the handler (the `custom_id` prefix, never its Custom ID State), guild and user.
 */
function logFields(interaction: Interaction): Record<string, unknown> {
  const { data, member, user, guild_id } = interaction as {
    data?: { name?: unknown; custom_id?: unknown };
    member?: { user?: { id: string } };
    user?: { id: string };
    guild_id?: string;
  };
  const userId = (member?.user ?? user)?.id;
  return {
    interactionId: interaction.id,
    interactionType: interaction.type,
    ...(typeof data?.name === "string" && { command: data.name }),
    ...(typeof data?.custom_id === "string" && { handler: prefixOf(data.custom_id)[0] }),
    ...(guild_id !== undefined && { guildId: guild_id }),
    ...(userId !== undefined && { userId }),
  };
}

function isInteraction(value: unknown): value is Interaction {
  if (typeof value !== "object" || value === null) return false;
  const { type, id } = value as { type?: unknown; id?: unknown };
  return typeof type === "number" && typeof id === "string";
}

const tooLarge = () => new Response("Payload Too Large", { status: 413 });
const notAnInteraction = () => new Response("Not an Interaction", { status: 400 });
