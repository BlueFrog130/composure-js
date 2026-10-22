import type { Upload } from "./components.ts"
import { type InteractionResponse, InteractionType, MessageFlags, ResponseType } from "./discord.ts"
import { ResponseError } from "./errors.ts"
import type { JSX } from "./jsx-runtime.ts"
import { isNode } from "./jsx/node.ts"
import { render } from "./jsx/render.ts"

const EPHEMERAL = Symbol.for("composurejs.ephemeral")
const UPDATE = Symbol.for("composurejs.update")

/** An Output only the invoking user sees. */
export interface EphemeralOutput {
  readonly [EPHEMERAL]: Output
}

/** An Output replacing the message a component is on. */
export interface UpdateOutput {
  readonly [UPDATE]: Output
}

/** What a handler may return to answer an Interaction. */
export type Output = string | JSX.Element | EphemeralOutput | UpdateOutput | InteractionResponse

/** Answers with `output`, visible only to the invoking user. */
export function Ephemeral(output: Output): EphemeralOutput {
  return { [EPHEMERAL]: output }
}

/** Answers a component or modal submit by replacing the message it came from. */
export function Update(output: Output): UpdateOutput {
  return { [UPDATE]: output }
}

const has = <K extends symbol>(value: unknown, key: K): value is Record<K, Output> => typeof value === "object" && value !== null && key in value

/** An InteractionResponse plus the files that must go with it. */
export interface Answer {
  response: InteractionResponse
  files: Upload[]
}

/** Turns an Output into the JSON Discord expects for an Interaction of `interactionType`, rendering and validating Views. */
export async function toAnswer(output: Output | undefined | void, interactionType: number): Promise<Answer> {
  if (typeof output === "string") {
    if (output === "") throw new ResponseError("A handler returned an empty string; Discord rejects empty messages")
    return { response: { type: ResponseType.ChannelMessageWithSource, data: { content: output } }, files: [] }
  }
  if (output instanceof Promise) return toAnswer(await output, interactionType)
  if (has(output, EPHEMERAL)) {
    const answer = await toAnswer(output[EPHEMERAL], interactionType)
    const { response } = answer
    if (response.type !== ResponseType.ChannelMessageWithSource) throw new ResponseError("Ephemeral only applies to new messages, not to Update, modals or deferrals")
    const data = response.data ?? {}
    return { ...answer, response: { ...response, data: { ...data, flags: (data.flags ?? 0) | MessageFlags.Ephemeral } } }
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
