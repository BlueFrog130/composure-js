// The request pipeline every platform shares (ADR 0007). An entry only maps a platform call to it.
import type {
  APIApplicationCommandAutocompleteInteraction,
  APIApplicationCommandInteractionDataBasicOption,
  APIApplicationCommandInteractionDataOption,
  APIApplicationCommandInteraction,
  APIInteractionDataResolved,
  APIMessage,
} from "discord-api-types/v10"
import { type App, type Built, internals } from "./app.ts"
import type { AnyCommand, Command, Group } from "./command.ts"
import { Context } from "./context.ts"
import type { Credentials } from "./credentials.ts"
import { type Interaction, type InteractionResponse, InteractionType, ResponseType } from "./discord.ts"
import { FAIL } from "./codec.ts"
import { DiscordApiError, InvalidOptionsError, ResponseError, UnknownCommandError, UserError } from "./errors.ts"
import { decodeEvent, EventContext } from "./events.ts"
import { dispatchHandler } from "./handlers.ts"
import { isNode } from "./jsx/node.ts"
import { serializeError } from "./log.ts"
import { runChain } from "./middleware.ts"
import { type Choice, OptionType, resolveOptions, resolveUser } from "./options.ts"
import { LIMITS } from "./jsx/render.ts"
import { type Answer, type Deferred, Ephemeral, isDeferred, type Output, rerendered, toAnswer, unwrapEphemeral, unwrapReply } from "./response.ts"
import type { RestOptions } from "./rest/client.ts"
import { InteractionClient } from "./rest/interaction.ts"
import { toMessageBody } from "./rest/message.ts"
import type { Transport } from "./transport.ts"
import type { BindingsOf, DataOf, Env, Platform } from "./types.ts"
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "./verify.ts"

/** Largest accepted request body; larger ones are answered 413. */
export const MAX_BODY_BYTES = 1024 * 1024

export const GENERIC_ERROR_MESSAGE = "Something went wrong."
export const OUTDATED_MESSAGE = "This message is outdated."

const NO_CHOICES: InteractionResponse = { type: ResponseType.ApplicationCommandAutocompleteResult, data: { choices: [] } }

export interface HandleOptions<E extends Env> {
  credentials: Credentials
  env: BindingsOf<E>
  data: DataOf<E>
  platform?: Platform | undefined
  /** Overrides the App's Transport. */
  transport?: Transport | undefined
}

/**
 * Answers one HTTP request carrying an Interaction (or, at the events path, a Webhook Event),
 * with Credentials and Bot Data already loaded. `app.fetch` loads them and calls this; use it
 * for custom routing.
 */
export async function handleInteraction<E extends Env>(app: App<E>, request: Request, options: HandleOptions<E>): Promise<Response> {
  const built = internals(app).build()
  if (new URL(request.url).pathname === built.eventsPath) return handleEvent(app, request, options)
  const read = await readSigned(built, request, options.credentials)
  if (read instanceof Response) return read
  const interaction = read
  if (!isInteraction(interaction)) return notAnInteraction()

  const rest = restOptions(built, options)
  const { answer, c } = await answerInteraction(built, interaction, options, rest)
  const client = () => c?.client ?? new InteractionClient(interaction.application_id, interaction.id, interaction.token, rest)

  if (answer.files.length > 0) return sendThroughCallback(built, interaction, answer, client())
  if (answer.deferred && c) {
    const work = runDeferred(built, c, answer.deferred)
    if (options.platform?.waitUntil) {
      options.platform.waitUntil(work)
      return Response.json(answer.response)
    }
    // No waitUntil (AWS Lambda, an untracked server): answer through the callback endpoint,
    // finish the work, then answer the HTTP request with 202 (ADR 0007).
    const sent = await sendThroughCallback(built, interaction, answer, client())
    if (sent.status === 202) await work
    return sent
  }
  return Response.json(answer.response)
}

function restOptions<E extends Env>(built: Built<E>, options: HandleOptions<E>): RestOptions {
  return { transport: options.transport ?? built.transport, logger: built.logger, maxRateLimitWait: built.maxRateLimitWait, timeout: built.requestTimeout }
}

/** Verifies and parses a signed request; a Response when it must be rejected. */
async function readSigned<E extends Env>(built: Built<E>, request: Request, credentials: Credentials): Promise<unknown> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } })
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge()
  const body = new Uint8Array(await request.arrayBuffer())
  if (body.byteLength > MAX_BODY_BYTES) return tooLarge()
  const verified = await verifySignature(credentials.publicKey, request.headers.get(SIGNATURE_HEADER), request.headers.get(TIMESTAMP_HEADER), body, {
    maxAge: built.maxSignatureAge,
  })
  if (!verified) return new Response("Invalid request signature", { status: 401 })
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown
  } catch {
    return notAnInteraction()
  }
}

/**
 * Answers a Webhook Event request: 204 at once, the App's Event Handler as Background Work.
 * Without a platform waitUntil the handler runs before the 204, within Discord's 3 seconds.
 */
export async function handleEvent<E extends Env>(app: App<E>, request: Request, options: HandleOptions<E>): Promise<Response> {
  const built = internals(app).build()
  const body = await readSigned(built, request, options.credentials)
  if (body instanceof Response) return body
  if (typeof body !== "object" || body === null || typeof (body as { type?: unknown }).type !== "number") return new Response("Not a webhook event", { status: 400 })
  const { type, event } = body as { type: number; event?: unknown }
  const ack = new Response(null, { status: 204 })
  // 0 is Discord's PING; types this version does not know are ACKed and ignored.
  if (type !== 1 || !built.events) return ack

  const decoded = decodeEvent(event)
  const c = new EventContext<E>({
    env: options.env,
    data: options.data,
    platform: options.platform,
    logger: built.logger,
    credentials: options.credentials,
    rest: restOptions(built, options),
  })
  const handler = built.events
  const work = (async () => {
    try {
      await handler(c, decoded)
    } catch (error) {
      // Only logged: the event is already ACKed.
      built.logger.error({ msg: "Event Handler failed", event: decoded.type, error: serializeError(error) })
    }
  })()
  if (options.platform?.waitUntil) options.platform.waitUntil(work)
  else await work
  return ack
}

/**
 * Answers through the callback endpoint (multipart when there are files), then answers the
 * HTTP request with 202. If Discord rejects it, the Interaction is still unanswered, so the
 * HTTP response carries the generic error instead.
 */
async function sendThroughCallback<E extends Env>(built: Built<E>, interaction: Interaction, answer: Answer, client: InteractionClient): Promise<Response> {
  try {
    await client.callback(answer.response, answer.files)
    return new Response(null, { status: 202 })
  } catch (error) {
    // DiscordApiError names the route template, never the URL: it holds the Interaction token.
    const detail = error instanceof DiscordApiError ? { status: error.status, code: error.code, route: error.route } : { error: serializeError(error) }
    built.logger.error({ msg: "Answering through the callback endpoint failed", interactionId: interaction.id, ...detail })
    return Response.json((await toAnswer(Ephemeral(GENERIC_ERROR_MESSAGE), interaction.type)).response)
  }
}

async function answerInteraction<E extends Env>(
  built: Built<E>,
  interaction: Interaction,
  options: HandleOptions<E>,
  rest: RestOptions,
): Promise<{ answer: Answer; c?: Context<E> }> {
  if (interaction.type === InteractionType.Ping) return { answer: { response: { type: ResponseType.Pong }, files: [] } }

  const c = new Context<E>({
    interaction,
    env: options.env,
    data: options.data,
    platform: options.platform,
    logger: built.logger,
    credentials: options.credentials,
    rest,
  })
  try {
    return { answer: await toAnswer(await dispatch(built, c), interaction.type), c }
  } catch (error) {
    if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
      // A message is no answer to autocomplete; the user sees no suggestions.
      built.logger.error({ msg: "Autocomplete failed", interactionId: interaction.id, command: interaction.data.name, error: serializeError(error) })
      return { answer: { response: NO_CHOICES, files: [] }, c }
    }
    return { answer: await renderError(built, error, c), c }
  }
}

/**
 * Background Work of a Deferred Response: run the work, then edit the original (the deferred
 * reply, or the component's message for deferUpdate). On failure the Error Renderer's output
 * edits the original, or for deferUpdate goes out as an ephemeral follow-up, so the component's
 * message keeps its state (composure-rs ADR 0006).
 */
async function runDeferred<E extends Env>(built: Built<E>, c: Context<E>, deferred: Deferred): Promise<void> {
  try {
    const [output, ephemeral] = unwrapEphemeral(await deferred.run())
    if (ephemeral && !deferred.ephemeral) {
      throw new ResponseError("Ephemerality is decided when deferring, as Discord fixes it then: c.defer(work, { ephemeral: true })")
    }
    if (isDeferred(output)) throw new ResponseError("Deferred work cannot defer again")
    await c.client.editOriginal(await toMessageBody(output))
  } catch (error) {
    try {
      const [output] = unwrapEphemeral(await errorOutput(built, error, c))
      if (deferred.kind === "update") await c.client.followup(Ephemeral(output))
      else await c.client.editOriginal(await toMessageBody(output as never))
    } catch (reportError) {
      built.logger.error({ msg: "Reporting failed deferred work failed", interactionId: c.interaction.id, error: serializeError(reportError) })
    }
  }
}

function dispatch<E extends Env>(built: Built<E>, c: Context<E>): Promise<Output> {
  const interaction = c.interaction
  switch (interaction.type) {
    case InteractionType.ApplicationCommand: {
      const entry = built.commands.get(`${interaction.data.type}:${interaction.data.name}`)
      if (!entry) {
        return runChain(built.middleware, c, () => {
          throw new UnknownCommandError(interaction.data.name)
        })
      }
      return runChain(entry.chain, c, () => invokeCommand(entry.command, c as Context<E, APIApplicationCommandInteraction>))
    }
    case InteractionType.ApplicationCommandAutocomplete: {
      const entry = built.commands.get(`${interaction.data.type}:${interaction.data.name}`)
      return runChain(entry?.chain ?? built.middleware, c, () =>
        entry ? autocomplete(built, entry.command, c as Context<E, APIApplicationCommandAutocompleteInteraction>) : NO_CHOICES,
      )
    }
    case InteractionType.MessageComponent:
    case InteractionType.ModalSubmit: {
      const customId = interaction.data.custom_id
      return runChain(built.middleware, c, async () => {
        const output = await dispatchHandler(c, customId)
        if (output === FAIL) {
          // An unknown handler id, or captures that no longer decode: the Fallback (ADR 0015).
          built.logger.debug({ msg: "Fallback", handler: customId.split(":")[0], interactionId: interaction.id })
          return Ephemeral(OUTDATED_MESSAGE)
        }
        return rerender(output, interaction)
      })
    }
    default:
      // A kind this version does not know (ADR 0003): answer, never crash.
      built.logger.warn({ msg: "Unknown interaction type", type: (interaction as { type: unknown }).type, interactionId: (interaction as { id?: unknown }).id })
      return runChain(built.middleware, c, () => Ephemeral(GENERIC_ERROR_MESSAGE))
  }
}

/** Command data of any command type, read field by field. */
interface CommandData {
  options?: APIApplicationCommandInteractionDataOption[]
  resolved?: APIInteractionDataResolved & { messages?: Record<string, APIMessage> }
  target_id?: string
}

/**
 * Markup returned from a click (or from a modal opened by one) updates that message; `c.reply(..)`
 * and `c.ephemeral(..)` answer with a new one, as does anything answering a modal opened by a Command.
 */
function rerender(output: Output, interaction: Interaction): Output {
  const [inner, reply] = unwrapReply(output)
  if (reply) return inner
  const fromMessage =
    interaction.type === InteractionType.MessageComponent || (interaction.type === InteractionType.ModalSubmit && "message" in interaction && interaction.message !== undefined)
  return fromMessage && (isNode(output) || output instanceof Promise) ? rerendered(output) : output
}

function invokeCommand<E extends Env>(command: AnyCommand<E>, c: Context<E, APIApplicationCommandInteraction>) {
  const data = c.interaction.data as CommandData
  switch (command.kind) {
    case "command":
    case "group": {
      const found = findLeaf(command, data.options)
      if (!found) throw new InvalidOptionsError(`No subcommand of "/${command.name}" matches the Interaction`)
      return found.leaf.handler(c as never, resolveOptions(found.leaf.options, found.options, data.resolved) as never)
    }
    case "user": {
      const target = data.target_id ? resolveUser(data.target_id, data.resolved) : undefined
      if (!target) throw new InvalidOptionsError(`User Command "${command.name}" has no resolved target user`)
      return command.handler(c as never, target)
    }
    case "message": {
      const target = data.target_id ? data.resolved?.messages?.[data.target_id] : undefined
      if (!target) throw new InvalidOptionsError(`Message Command "${command.name}" has no resolved target message`)
      return command.handler(c as never, target)
    }
  }
}

interface Leaf<E extends Env> {
  leaf: Command<E>
  options: APIApplicationCommandInteractionDataBasicOption[] | undefined
}

/** The Command a Group's Interaction addresses, with that Command's raw Options. */
function findLeaf<E extends Env>(command: Command<E> | Group<E>, options: APIApplicationCommandInteractionDataOption[] | undefined): Leaf<E> | undefined {
  if (command.kind === "command") return { leaf: command, options: options as APIApplicationCommandInteractionDataBasicOption[] | undefined }
  const first = options?.[0]
  const sub = first && command.subcommands.find((s) => s.name === first.name)
  if (!first || !sub) return undefined
  if (first.type === OptionType.SubcommandGroup && sub.kind === "group") return findLeaf(sub, first.options)
  if (first.type === OptionType.Subcommand && sub.kind === "command") return { leaf: sub, options: first.options }
  return undefined
}

async function autocomplete<E extends Env>(built: Built<E>, command: AnyCommand<E>, c: Context<E, APIApplicationCommandAutocompleteInteraction>): Promise<Output> {
  if (command.kind !== "command" && command.kind !== "group") return NO_CHOICES
  const found = findLeaf(command, c.interaction.data.options as APIApplicationCommandInteractionDataOption[])
  const focused = found?.options?.find((o) => "focused" in o && o.focused)
  const handler = found && focused && found.leaf.options[focused.name]?.spec.autocomplete
  if (!found || !focused || !handler || !("value" in focused)) return NO_CHOICES

  const others: Record<string, string | number | boolean> = {}
  for (const o of found.options ?? []) if (o !== focused && "value" in o) others[o.name] = o.value
  const results = await handler(c as never, String(focused.value), others)
  return { type: ResponseType.ApplicationCommandAutocompleteResult, data: { choices: suggestions(built, c, results) } }
}

/**
 * Discord rejects the whole answer for one bad Choice, and the user would see no suggestions
 * without knowing why: over-long names are cut, empty names and over-long values are dropped
 * (logged), and the first 25 are kept.
 */
function suggestions<E extends Env>(built: Built<E>, c: Context<E>, results: readonly (Choice | string | number)[]): Choice[] {
  const out: Choice[] = []
  for (const r of results) {
    if (out.length === LIMITS.selectOptions) break
    const { name, value } = typeof r === "object" ? r : { name: String(r), value: r }
    if (name === "" || (typeof value === "string" && (value === "" || value.length > LIMITS.optionText))) {
      built.logger.warn({ msg: "Autocomplete Choice dropped: names and string values must be 1-100 characters", interactionId: c.interaction.id, name: name.slice(0, 40) })
      continue
    }
    out.push({ name: name.length > LIMITS.optionText ? `${name.slice(0, LIMITS.optionText - 1)}…` : name, value })
  }
  return out
}

/** The Error Renderer's output, ephemeral; logs every error except User Errors. */
async function renderError<E extends Env>(built: Built<E>, error: unknown, c: Context<E>): Promise<Answer> {
  const output = await errorOutput(built, error, c)
  try {
    return await toAnswer(Ephemeral(unwrapEphemeral(output)[0]), c.interaction.type)
  } catch (rendererError) {
    built.logger.error({ msg: "Error Renderer failed", interactionId: c.interaction.id, error: serializeError(rendererError) })
    return toAnswer(Ephemeral(defaultErrorOutput(error)), c.interaction.type)
  }
}

/** Logs `error` (User Errors at debug) and asks the Error Renderer what the user sees. */
async function errorOutput<E extends Env>(built: Built<E>, error: unknown, c: Context<E>): Promise<Output> {
  const entry = { interactionId: c.interaction.id, type: c.interaction.type, ...routeOf(c.interaction), error: serializeError(error) }
  if (error instanceof UserError) built.logger.debug({ msg: "User Error", ...entry })
  else if (error instanceof UnknownCommandError) built.logger.warn({ msg: "Unknown Command", ...entry })
  else if (error instanceof InvalidOptionsError) built.logger.warn({ msg: "Invalid Options", ...entry })
  else built.logger.error({ msg: "Handler failed", ...entry })
  try {
    return built.onError ? await built.onError(error, c) : defaultErrorOutput(error)
  } catch (rendererError) {
    built.logger.error({ msg: "Error Renderer failed", interactionId: c.interaction.id, error: serializeError(rendererError) })
    return defaultErrorOutput(error)
  }
}

/** What the user sees without an Error Renderer: a User Error's message, else a generic one. */
export function defaultErrorOutput(error: unknown): string {
  return error instanceof UserError ? error.message : GENERIC_ERROR_MESSAGE
}

function routeOf(interaction: Interaction): { command?: string } {
  return interaction.type === InteractionType.ApplicationCommand ? { command: interaction.data.name } : {}
}

function isInteraction(value: unknown): value is Interaction {
  if (typeof value !== "object" || value === null) return false
  const { type, id } = value as { type?: unknown; id?: unknown }
  return typeof type === "number" && typeof id === "string"
}

const tooLarge = () => new Response("Payload Too Large", { status: 413 })
const notAnInteraction = () => new Response("Not an Interaction", { status: 400 })
