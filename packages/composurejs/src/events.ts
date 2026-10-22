// Webhook Events (composure-rs ADR 0008): same entrypoint, routed by path, ACKed with 204 and
// handled as Background Work. Unknown or mismatched events decode to `unknown`; never an error,
// because repeated failures get Discord to disable the events URL.
import type { APIEntitlement, APIWebhookEventApplicationAuthorizedData, APIWebhookEventApplicationDeauthorizedData } from "discord-api-types/v10"
import type { Credentials } from "./credentials.ts"
import { CredentialsError } from "./errors.ts"
import { type Logger, serializeError } from "./log.ts"
import { BotClient, type RestOptions } from "./rest/client.ts"
import type { BindingsOf, DataOf, Env, MaybePromise, Platform } from "./types.ts"

interface Base<T extends string, D> {
  type: T
  /** ISO 8601. */
  timestamp: string
  data: D
}

export type WebhookEvent =
  | Base<"APPLICATION_AUTHORIZED", APIWebhookEventApplicationAuthorizedData>
  | Base<"APPLICATION_DEAUTHORIZED", APIWebhookEventApplicationDeauthorizedData>
  | Base<"ENTITLEMENT_CREATE" | "ENTITLEMENT_UPDATE" | "ENTITLEMENT_DELETE", APIEntitlement>
  | Base<"QUEST_USER_ENROLLMENT", unknown>
  /** An event this version does not know, or whose data does not match: the event as sent. */
  | { type: "unknown"; raw: unknown }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Decodes a webhook event body's `event`; anything unexpected becomes `{ type: "unknown", raw }`. */
export function decodeEvent(event: unknown): WebhookEvent {
  const unknown = { type: "unknown" as const, raw: event }
  if (!isObject(event) || typeof event.type !== "string" || typeof event.timestamp !== "string") return unknown
  const { type, timestamp, data } = event
  switch (type) {
    case "APPLICATION_AUTHORIZED":
    case "APPLICATION_DEAUTHORIZED":
      return isObject(data) && isObject(data.user) && typeof data.user.id === "string" ? ({ type, timestamp, data } as unknown as WebhookEvent) : unknown
    case "ENTITLEMENT_CREATE":
    case "ENTITLEMENT_UPDATE":
    case "ENTITLEMENT_DELETE":
      return isObject(data) && typeof data.id === "string" && typeof data.sku_id === "string" ? ({ type, timestamp, data } as unknown as WebhookEvent) : unknown
    case "QUEST_USER_ENROLLMENT":
      return { type, timestamp, data }
  }
  return unknown
}

export interface EventContextInit<E extends Env> {
  env: BindingsOf<E>
  data: DataOf<E>
  platform: Platform | undefined
  logger: Logger
  credentials: Credentials
  rest: RestOptions
}

/** What an Event Handler receives besides the event: the Env, Bot Data and the Bot Client. */
export class EventContext<E extends Env = Env> {
  readonly env: BindingsOf<E>
  readonly data: DataOf<E>
  readonly #init: EventContextInit<E>
  #bot: BotClient | undefined

  constructor(init: EventContextInit<E>) {
    this.env = init.env
    this.data = init.data
    this.#init = init
  }

  get bot(): BotClient {
    const { token } = this.#init.credentials
    if (!token) throw new CredentialsError("c.bot needs a bot token: set DISCORD_TOKEN (or Credentials.token)")
    return (this.#bot ??= new BotClient(token, this.#init.rest))
  }

  /** More Background Work; rejections are logged. */
  waitUntil(promise: Promise<unknown>): void {
    const logged = promise.catch((error: unknown) => this.#init.logger.error({ msg: "Background Work failed", error: serializeError(error) }))
    this.#init.platform?.waitUntil?.(logged)
  }
}

/** Answers Webhook Events. At most one App in a tree sets it. */
export type EventHandler<E extends Env = Env> = (c: EventContext<E>, event: WebhookEvent) => MaybePromise<void>
