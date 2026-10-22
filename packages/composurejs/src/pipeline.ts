// The request pipeline every Adapter shares (ADR 0007). Adapters only map platform calls to it.
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
import { InvalidOptionsError, UnknownCommandError, UserError } from "./errors.ts"
import { serializeError } from "./log.ts"
import { runChain } from "./middleware.ts"
import { OptionType, resolveOptions, resolveUser } from "./options.ts"
import { type Answer, Ephemeral, type Output, toAnswer } from "./response.ts"
import { DISCORD_API, multipart, type Transport } from "./transport.ts"
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
 * Answers one HTTP request carrying an Interaction, with Credentials and Bot Data already
 * loaded. `app.fetch` loads them and calls this; use it for custom routing.
 */
export async function handleInteraction<E extends Env>(app: App<E>, request: Request, options: HandleOptions<E>): Promise<Response> {
  const built = internals(app).build()
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } })
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge()
  const body = new Uint8Array(await request.arrayBuffer())
  if (body.byteLength > MAX_BODY_BYTES) return tooLarge()

  const verified = await verifySignature(
    options.credentials.publicKey,
    request.headers.get(SIGNATURE_HEADER),
    request.headers.get(TIMESTAMP_HEADER),
    body,
    { maxAge: built.maxSignatureAge },
  )
  if (!verified) return new Response("Invalid request signature", { status: 401 })

  let interaction: unknown
  try {
    interaction = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return notAnInteraction()
  }
  if (!isInteraction(interaction)) return notAnInteraction()

  const answer = await answerInteraction(built, interaction, options)
  if (answer.files.length > 0) return sendWithFiles(built, interaction, answer, options.transport ?? built.transport)
  return Response.json(answer.response)
}

/**
 * Files cannot ride on the HTTP response: send the answer as multipart through the callback
 * endpoint, then answer the request with 202. If Discord rejects it, the Interaction is still
 * unanswered, so the HTTP response carries the generic error instead.
 */
async function sendWithFiles<E extends Env>(built: Built<E>, interaction: Interaction, answer: Answer, transport: Transport): Promise<Response> {
  const url = `${DISCORD_API}/interactions/${interaction.id}/${interaction.token}/callback`
  let failure: Record<string, unknown> | undefined
  try {
    const res = await transport(new Request(url, { method: "POST", body: multipart(answer.response as { data?: object }, answer.files) }))
    if (res.ok) return new Response(null, { status: 202 })
    failure = { status: res.status, body: (await res.text()).slice(0, 2000) }
  } catch (error) {
    failure = { error: serializeError(error) }
  }
  // Log the route template, never the URL: it holds the Interaction token.
  built.logger.error({ msg: "Sending a response with files failed", route: "POST /interactions/{id}/{token}/callback", interactionId: interaction.id, ...failure })
  return Response.json((await toAnswer(Ephemeral(GENERIC_ERROR_MESSAGE), interaction.type)).response)
}

async function answerInteraction<E extends Env>(built: Built<E>, interaction: Interaction, options: HandleOptions<E>): Promise<Answer> {
  if (interaction.type === InteractionType.Ping) return { response: { type: ResponseType.Pong }, files: [] }

  const c = new Context<E>({
    interaction,
    env: options.env,
    data: options.data,
    platform: options.platform,
    logger: built.logger,
  })
  try {
    return await toAnswer(await dispatch(built, c), interaction.type)
  } catch (error) {
    if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
      // A message is no answer to autocomplete; the user sees no suggestions.
      built.logger.error({ msg: "Autocomplete failed", interactionId: interaction.id, command: interaction.data.name, error: serializeError(error) })
      return { response: NO_CHOICES, files: [] }
    }
    return renderError(built, error, c)
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
        entry ? autocomplete(entry.command, c as Context<E, APIApplicationCommandAutocompleteInteraction>) : NO_CHOICES,
      )
    }
    case InteractionType.MessageComponent:
    case InteractionType.ModalSubmit:
      // No Component or Modal Handler answers this custom_id: the Fallback.
      return runChain(built.middleware, c, () => Ephemeral(OUTDATED_MESSAGE))
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

async function autocomplete<E extends Env>(command: AnyCommand<E>, c: Context<E, APIApplicationCommandAutocompleteInteraction>): Promise<Output> {
  if (command.kind !== "command" && command.kind !== "group") return NO_CHOICES
  const found = findLeaf(command, c.interaction.data.options as APIApplicationCommandInteractionDataOption[])
  const focused = found?.options?.find((o) => "focused" in o && o.focused)
  const handler = found && focused && found.leaf.options[focused.name]?.spec.autocomplete
  if (!found || !focused || !handler || !("value" in focused)) return NO_CHOICES

  const others: Record<string, string | number | boolean> = {}
  for (const o of found.options ?? []) if (o !== focused && "value" in o) others[o.name] = o.value
  const results = await handler(c as never, String(focused.value), others)
  return {
    type: ResponseType.ApplicationCommandAutocompleteResult,
    data: {
      choices: results.slice(0, 25).map((r) => (typeof r === "object" ? { name: r.name, value: r.value } : { name: String(r), value: r })),
    },
  }
}

/** The Error Renderer's output, ephemeral; logs every error except User Errors. */
async function renderError<E extends Env>(built: Built<E>, error: unknown, c: Context<E>): Promise<Answer> {
  const entry = { interactionId: c.interaction.id, type: c.interaction.type, ...routeOf(c.interaction), error: serializeError(error) }
  if (error instanceof UserError) built.logger.debug({ msg: "User Error", ...entry })
  else if (error instanceof UnknownCommandError) built.logger.warn({ msg: "Unknown Command", ...entry })
  else if (error instanceof InvalidOptionsError) built.logger.warn({ msg: "Invalid Options", ...entry })
  else built.logger.error({ msg: "Handler failed", ...entry })

  try {
    const output = built.onError ? await built.onError(error, c) : defaultErrorOutput(error)
    return await toAnswer(Ephemeral(output), c.interaction.type)
  } catch (rendererError) {
    built.logger.error({ msg: "Error Renderer failed", interactionId: c.interaction.id, error: serializeError(rendererError) })
    return toAnswer(Ephemeral(defaultErrorOutput(error)), c.interaction.type)
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
