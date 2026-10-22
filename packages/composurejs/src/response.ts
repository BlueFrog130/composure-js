import { type InteractionResponse, MessageFlags, ResponseType } from "./discord.ts"
import { ResponseError } from "./errors.ts"
import type { JSX } from "./jsx-runtime.ts"
import { isNode } from "./jsx/node.ts"
import { renderMessage } from "./jsx/render.ts"

const EPHEMERAL = Symbol.for("composurejs.ephemeral")

/** An Output only the invoking user sees. */
export interface EphemeralOutput {
  readonly [EPHEMERAL]: Output
}

/** What a handler may return to answer an Interaction. */
export type Output = string | JSX.Element | EphemeralOutput | InteractionResponse

/** Answers with `output`, visible only to the invoking user. */
export function Ephemeral(output: Output): EphemeralOutput {
  return { [EPHEMERAL]: output }
}

function isEphemeral(value: unknown): value is EphemeralOutput {
  return typeof value === "object" && value !== null && EPHEMERAL in value
}

/** Turns an Output into the JSON Discord expects, rendering and validating Views. */
export async function toInteractionResponse(output: Output | undefined | void): Promise<InteractionResponse> {
  if (typeof output === "string") {
    if (output === "") throw new ResponseError("A handler returned an empty string; Discord rejects empty messages")
    return { type: ResponseType.ChannelMessageWithSource, data: { content: output } }
  }
  if (output instanceof Promise) return toInteractionResponse(await output)
  if (isEphemeral(output)) {
    const response = await toInteractionResponse(output[EPHEMERAL])
    if (response.type !== ResponseType.ChannelMessageWithSource) {
      throw new ResponseError("Ephemeral only applies to message responses")
    }
    const data = response.data ?? {}
    return { ...response, data: { ...data, flags: (data.flags ?? 0) | MessageFlags.Ephemeral } }
  }
  if (isNode(output)) {
    return { type: ResponseType.ChannelMessageWithSource, data: await renderMessage(output) }
  }
  if (typeof output === "object" && output !== null && typeof (output as { type?: unknown }).type === "number") {
    return output
  }
  throw new ResponseError(`A handler returned ${output === undefined ? "nothing" : typeof output}; return a string, a View or a response`)
}
