import type { Upload } from "./components.ts"
import { type InteractionResponse, InteractionType, MessageFlags, ResponseType } from "./discord.ts"
import { ResponseError } from "./errors.ts"
import type { JSX } from "./jsx-runtime.ts"
import { isNode } from "./jsx/node.ts"
import { render } from "./jsx/render.ts"

const EPHEMERAL = Symbol.for("composurejs.ephemeral")
const UPDATE = Symbol.for("composurejs.update")
const RERENDER = Symbol("composurejs.rerender")
const DEFER = Symbol.for("composurejs.defer")
const REPLY = Symbol.for("composurejs.reply")

/** An Output only the invoking user sees. */
export interface EphemeralOutput {
  readonly [EPHEMERAL]: Output
}

/** An Output replacing the message a component is on. */
export interface UpdateOutput {
  readonly [UPDATE]: Output
}

/** Work finished after answering (ADR 0007): `c.defer(..)` and `c.deferUpdate(..)`. */
export interface Deferred {
  /** `message`: a loading reply (type 5), then the result edits it. `update`: acknowledge a component (type 6), then edit its message. */
  readonly kind: "message" | "update"
  /** Decided when deferring, because Discord fixes it then. */
  readonly ephemeral: boolean
  run(): Promise<Output>
}

/** An Output answering now and finishing as Background Work. */
export interface DeferredOutput {
  readonly [DEFER]: Deferred
}

/** What a handler may return to answer an Interaction. */
export type Output = string | JSX.Element | EphemeralOutput | UpdateOutput | DeferredOutput | InteractionResponse

export function deferredOutput(deferred: Deferred): DeferredOutput {
  return { [DEFER]: deferred }
}

export function isDeferred(value: unknown): value is DeferredOutput {
  return typeof value === "object" && value !== null && DEFER in value
}

/** Splits `Ephemeral(x)` into `x` and whether it was wrapped. */
export function unwrapEphemeral(output: Output): [Output, boolean] {
  return has(output, EPHEMERAL) ? [output[EPHEMERAL], true] : [output, false]
}

/** Answers with `output`, visible only to the invoking user. */
export function Ephemeral(output: Output): EphemeralOutput {
  return { [EPHEMERAL]: output }
}

/** Answers a component or modal submit by replacing the message it came from. */
export function Update(output: Output): UpdateOutput {
  return { [UPDATE]: output }
}

/** Answers a component click with a new message instead of updating the clicked one. */
export function Reply(output: Output): Output {
  return { [REPLY]: output } as unknown as Output
}

/** Splits `Reply(x)` into `x` and whether it was wrapped. */
export function unwrapReply(output: Output): [Output, boolean] {
  return has(output, REPLY) ? [output[REPLY], true] : [output, false]
}

/** @internal Markup returned from a click on a message: updates that message, or opens a returned modal. */
export function rerendered(output: Output): Output {
  return { [RERENDER]: output } as unknown as Output
}

const has = <K extends symbol>(value: unknown, key: K): value is Record<K, Output> => typeof value === "object" && value !== null && key in value

/** An InteractionResponse plus the files that must go with it. */
export interface Answer {
  response: InteractionResponse
  files: Upload[]
  /** Work to run after answering, for deferred answers. */
  deferred?: Deferred
}

/** Turns an Output into the JSON Discord expects for an Interaction of `interactionType`, rendering and validating Views. */
export async function toAnswer(output: Output | undefined | void, interactionType: number): Promise<Answer> {
  if (typeof output === "string") {
    if (output === "") throw new ResponseError("A handler returned an empty string; Discord rejects empty messages")
    return { response: { type: ResponseType.ChannelMessageWithSource, data: { content: output } }, files: [] }
  }
  if (output instanceof Promise) return toAnswer(await output, interactionType)
  if (has(output, EPHEMERAL)) {
    const inner = output[EPHEMERAL]
    if (isDeferred(inner)) {
      if (inner[DEFER].kind === "update") throw new ResponseError("deferUpdate edits the component's message, which cannot become ephemeral")
      return toAnswer(deferredOutput({ ...inner[DEFER], ephemeral: true }), interactionType)
    }
    const answer = await toAnswer(output[EPHEMERAL], interactionType)
    const { response } = answer
    if (response.type !== ResponseType.ChannelMessageWithSource) throw new ResponseError("Ephemeral only applies to new messages, not to Update, modals or deferrals")
    const data = response.data ?? {}
    return { ...answer, response: { ...response, data: { ...data, flags: (data.flags ?? 0) | MessageFlags.Ephemeral } } }
  }
  if (isDeferred(output)) {
    const deferred = output[DEFER]
    if (deferred.kind === "update") {
      if (interactionType !== InteractionType.MessageComponent && interactionType !== InteractionType.ModalSubmit) {
        throw new ResponseError("deferUpdate only answers component clicks and modal submits")
      }
      return { response: { type: ResponseType.DeferredMessageUpdate }, files: [], deferred }
    }
    const data = deferred.ephemeral ? { data: { flags: MessageFlags.Ephemeral } } : {}
    return { response: { type: ResponseType.DeferredChannelMessageWithSource, ...data }, files: [], deferred }
  }
  if (has(output, REPLY)) return toAnswer(output[REPLY], interactionType)
  if (has(output, RERENDER)) {
    const answer = await toAnswer(output[RERENDER], interactionType)
    if (answer.response.type !== ResponseType.ChannelMessageWithSource) return answer
    return toAnswer(Update(answer.response), interactionType).then((a) => ({ ...answer, response: a.response }))
  }
  if (has(output, UPDATE)) {
    if (interactionType !== InteractionType.MessageComponent && interactionType !== InteractionType.ModalSubmit) {
      throw new ResponseError("Update only answers component clicks and modal submits")
    }
    const answer = await toAnswer(output[UPDATE], interactionType)
    const { response } = answer
    if (response.type !== ResponseType.ChannelMessageWithSource) throw new ResponseError("Update takes a message, not a modal or deferral")
    if ((response.data?.flags ?? 0) & MessageFlags.Ephemeral) throw new ResponseError("Update cannot change whether a message is ephemeral")
    return { ...answer, response: { type: ResponseType.UpdateMessage, data: response.data ?? {} } }
  }
  if (isNode(output)) {
    const rendered = await render(output)
    if (rendered.kind === "modal") {
      if (interactionType === InteractionType.ModalSubmit) throw new ResponseError("A modal submit cannot be answered with another <Modal>")
      return { response: { type: ResponseType.Modal, data: rendered.data }, files: [] }
    }
    return { response: { type: ResponseType.ChannelMessageWithSource, data: rendered.data as never }, files: rendered.files }
  }
  if (typeof output === "object" && output !== null && typeof (output as { type?: unknown }).type === "number") {
    const data = (output as { data?: { flags?: number; content?: string; embeds?: unknown[] } }).data
    if (data && (data.flags ?? 0) & MessageFlags.IsComponentsV2 && (data.content || data.embeds?.length)) {
      throw new ResponseError("A Components V2 message (IS_COMPONENTS_V2) cannot carry content or embeds")
    }
    return { response: output as InteractionResponse, files: [] }
  }
  throw new ResponseError(`A handler returned ${output === undefined ? "nothing" : typeof output}; return a string, a View or a response`)
}
