// REST authorized by an Interaction's token (ADR 0006): follow-ups and the original response.
// Needs no bot token; valid for 15 minutes after the Interaction.
import type { Upload } from "../components.ts"
import type { InteractionResponse } from "../discord.ts"
import { DiscordApiError } from "../errors.ts"
import { type RequestBody, type ResponseBody, RestClient, type RestOptions } from "./client.ts"
import { ROUTES } from "./endpoints.ts"
import { type MessageInput, toMessageBody } from "./message.ts"
import { multipart } from "../transport.ts"

type EditBody = RequestBody<"update_original_webhook_message">
type Message = ResponseBody<"get_original_webhook_message">

/** Delays between retries of editing the original response while Discord reports it unknown (404). */
const ORIGINAL_RETRY_MS = [250, 500, 1000, 2000]

export class InteractionClient {
  readonly #rest: RestClient
  readonly #params: { webhook_id: string; webhook_token: string }
  readonly #route: string | undefined

  constructor(
    readonly applicationId: string,
    readonly interactionId: string,
    readonly token: string,
    options: RestOptions = {},
  ) {
    this.#rest = new RestClient(undefined, options)
    this.#route = options.route
    this.#params = { webhook_id: applicationId, webhook_token: token }
  }

  getOriginal(): Promise<Message> {
    return this.#rest.request(ROUTES.getOriginalResponse, { params: this.#params })
  }

  /**
   * Edits the original response with a View, text or raw body. Retries briefly on 404, since
   * Background Work can reach Discord before the deferred reply is registered (ADR 0007).
   */
  async editOriginal(message: MessageInput<EditBody>): Promise<ResponseBody<"update_original_webhook_message">> {
    const { json, files } = await toMessageBody(message, { route: this.#route })
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#rest.request(ROUTES.editOriginalResponse, { params: this.#params, body: json, files })
      } catch (error) {
        const delay = ORIGINAL_RETRY_MS[attempt]
        if (!(error instanceof DiscordApiError && error.status === 404) || delay === undefined) throw error
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  deleteOriginal(): Promise<undefined> {
    return this.#rest.request(ROUTES.deleteOriginalResponse, { params: this.#params })
  }

  /** Sends a follow-up message; `Ephemeral(..)` makes it visible only to the invoking user. */
  async followup(message: MessageInput<RequestBody<"execute_webhook">>): Promise<Message> {
    const { json, files } = await toMessageBody(message, { ephemeral: true, route: this.#route })
    return this.#rest.request(ROUTES.executeWebhook, { params: this.#params, query: { wait: true }, body: json, files })
  }

  getFollowup(messageId: string): Promise<Message> {
    return this.#rest.request(ROUTES.getFollowup, { params: { ...this.#params, message_id: messageId } })
  }

  async editFollowup(messageId: string, message: MessageInput<RequestBody<"update_webhook_message">>): Promise<Message> {
    const { json, files } = await toMessageBody(message, { route: this.#route })
    return this.#rest.request(ROUTES.editFollowup, { params: { ...this.#params, message_id: messageId }, body: json, files })
  }

  deleteFollowup(messageId: string): Promise<undefined> {
    return this.#rest.request(ROUTES.deleteFollowup, { params: { ...this.#params, message_id: messageId } })
  }

  /** Answers the Interaction through the callback endpoint instead of the HTTP response. */
  callback(response: InteractionResponse, files: readonly Upload[] = []): Promise<unknown> {
    const params = { interaction_id: this.interactionId, interaction_token: this.token }
    if (files.length === 0) return this.#rest.request(ROUTES.createInteractionResponse, { params, body: response })
    return this.#rest.request(ROUTES.createInteractionResponse, { params, multipart: multipart(response as { data?: object }, files) })
  }
}
