// REST message bodies accept a View (ADR 0006): rendered and validated exactly as a response is.
import type { Upload } from "../components.ts";
import { MessageFlags } from "../discord.ts";
import { ResponseError } from "../errors.ts";
import type { JSX } from "../jsx-runtime.ts";
import { isNode } from "../jsx/node.ts";
import { renderMessage } from "../jsx/render.ts";
import { type EphemeralOutput, unwrapEphemeral } from "../response.ts";
import { attachmentsOf } from "../transport.ts";

const BODY = Symbol("composurejs.messageBody");

/** A message to send: text, a View, or a raw JSON body. `Ephemeral(..)` only for follow-ups. */
export type MessageInput<Body = Record<string, unknown>> = string | JSX.Element | EphemeralOutput | MessageBody | Body;

/** A rendered message: its JSON (with `attachments` when there are files) and the files. */
export interface MessageBody {
  readonly [BODY]: true;
  json: Record<string, unknown>;
  files: Upload[];
}

/** @internal A rendered interaction response's `data` and files as a message body. */
export function messageBody(json: Record<string, unknown>, files: Upload[]): MessageBody {
  return { [BODY]: true, json: files.length > 0 ? { ...json, attachments: attachmentsOf(files) } : { ...json }, files };
}

/** Renders a MessageInput into a JSON body (plus files). */
export async function toMessageBody(input: MessageInput<object>, { ephemeral = false, route }: { ephemeral?: boolean; route?: string | undefined } = {}): Promise<MessageBody> {
  if (typeof input === "object" && input !== null && BODY in input) return input as MessageBody;
  const [inner, isEphemeral] = unwrapEphemeral(input as never);
  if (isEphemeral && !ephemeral) throw new ResponseError("Ephemeral only applies to interaction follow-ups");
  let body: { json: Record<string, unknown>; files: Upload[] };
  if (typeof inner === "string") {
    if (inner === "") throw new ResponseError("Discord rejects empty messages");
    body = { json: { content: inner }, files: [] };
  } else if (inner instanceof Promise || isNode(inner)) {
    const rendered = await renderMessage((await inner) as JSX.Element, { route });
    body = { json: { ...rendered.data }, files: rendered.files };
  } else if (typeof inner === "object" && inner !== null) {
    if (Object.getOwnPropertySymbols(inner).length > 0) throw new ResponseError("Update and deferrals only answer Interactions; send a message, View or body");
    const json = { ...(inner as unknown as Record<string, unknown>) };
    if (((json.flags as number | undefined) ?? 0) & MessageFlags.IsComponentsV2 && (json.content || (json.embeds as unknown[] | undefined)?.length)) {
      throw new ResponseError("A Components V2 message (IS_COMPONENTS_V2) cannot carry content or embeds");
    }
    body = { json, files: [] };
  } else {
    throw new ResponseError(`Cannot send ${typeof inner} as a message`);
  }
  if (isEphemeral) body.json.flags = ((body.json.flags as number | undefined) ?? 0) | MessageFlags.Ephemeral;
  if (body.files.length > 0) body.json.attachments = attachmentsOf(body.files);
  return { [BODY]: true, ...body };
}
