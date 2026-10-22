import type { Entitlement, Interaction, Member, User } from "./discord.ts"
import { type Logger, serializeError } from "./log.ts"
import type { Credentials } from "./credentials.ts"
import { CredentialsError } from "./errors.ts"
import { deferredOutput, type DeferredOutput, Ephemeral, type EphemeralOutput, type Output, Reply } from "./response.ts"
import { BotClient, type RestOptions } from "./rest/client.ts"
import { InteractionClient } from "./rest/interaction.ts"
import type { BindingsOf, DataOf, Env, MaybePromise, Platform, VariablesOf } from "./types.ts"

export interface ContextInit<E extends Env, I extends Interaction> {
  interaction: I
  env: BindingsOf<E>
  data: DataOf<E>
  platform: Platform | undefined
  logger: Logger
  credentials: Credentials
  rest: RestOptions
}

/** The `c` every handler receives. */
export class Context<E extends Env = Env, I extends Interaction = Interaction> {
  /** The Interaction, typed by its kind. */
  readonly interaction: I
  /** Platform bindings, secrets and vars. */
  readonly env: BindingsOf<E>
  /** Bot Data, built once per isolate. */
  readonly data: DataOf<E>
  readonly #platform: Platform | undefined
  readonly #logger: Logger
  readonly #vars: Record<string, unknown> = {}
  readonly #credentials: Credentials
  readonly #rest: RestOptions
  #client: InteractionClient | undefined
  #bot: BotClient | undefined

  constructor(init: ContextInit<E, I>) {
    this.interaction = init.interaction
    this.env = init.env
    this.data = init.data
    this.#platform = init.platform
    this.#logger = init.logger
    this.#credentials = init.credentials
    this.#rest = init.rest
  }

  /** REST authorized by this Interaction's token: follow-ups and the original response. */
  get client(): InteractionClient {
    const { application_id, id, token } = this.interaction
    return (this.#client ??= new InteractionClient(application_id, id, token, this.#rest))
  }

  /** REST authorized by the bot token, for the Endpoints in `composurejs/rest`. Throws when the Credentials have none. */
  get bot(): BotClient {
    const { token } = this.#credentials
    if (!token) throw new CredentialsError("c.bot needs a bot token: set DISCORD_TOKEN (or Credentials.token)")
    return (this.#bot ??= new BotClient(token, this.#rest))
  }

  /**
   * Answers now with a loading state (Discord allows 3 seconds), then edits in `work`'s result as
   * Background Work, bounded by the platform (about 30s on Workers). Whether the message is
   * ephemeral is decided here, because Discord fixes it on the deferred reply.
   */
  defer(work: (c: this) => MaybePromise<Output>, options: { ephemeral?: boolean } = {}): DeferredOutput {
    return deferredOutput({ kind: "message", ephemeral: options.ephemeral ?? false, run: async () => work(this) })
  }

  /** For a component: acknowledges without changing its message, then edits that message with `work`'s result. */
  deferUpdate(work: (c: this) => MaybePromise<Output>): DeferredOutput {
    return deferredOutput({ kind: "update", ephemeral: false, run: async () => work(this) })
  }

  /** The Interaction's JSON as Discord sent it, including fields the Wire Types do not know. */
  get raw(): Readonly<Record<string, unknown>> {
    return this.interaction as unknown as Record<string, unknown>
  }

  /** Who invoked the Interaction, in a guild or not. */
  get user(): User {
    const i = this.interaction as { member?: Member; user?: User }
    return (i.member?.user ?? i.user)!
  }

  get member(): Member | undefined {
    return (this.interaction as { member?: Member }).member
  }

  get guildId(): string | undefined {
    return this.interaction.guild_id
  }

  get channelId(): string | undefined {
    return this.interaction.channel?.id ?? this.interaction.channel_id
  }

  /** The invoking user's locale (not set on Ping). */
  get locale(): string | undefined {
    return (this.interaction as { locale?: string }).locale
  }

  get entitlements(): Entitlement[] {
    return this.interaction.entitlements ?? []
  }

  /** Middleware Variables. */
  get var(): Readonly<VariablesOf<E>> {
    return this.#vars as VariablesOf<E>
  }

  set<K extends keyof VariablesOf<E> & string>(key: K, value: VariablesOf<E>[K]): void {
    this.#vars[key] = value
  }

  get<K extends keyof VariablesOf<E> & string>(key: K): VariablesOf<E>[K] {
    return this.#vars[key] as VariablesOf<E>[K]
  }

  /** Runs `promise` as Background Work; rejections are logged. */
  waitUntil(promise: Promise<unknown>): void {
    const logged = promise.catch((error: unknown) => {
      this.#logger.error({ msg: "Background Work failed", interactionId: this.interaction.id, error: serializeError(error) })
    })
    // Without a platform waitUntil the work still runs, untracked.
    this.#platform?.waitUntil?.(logged)
  }

  /** Answers with `output`, visible only to the invoking user. */
  ephemeral(output: Output): EphemeralOutput {
    return Ephemeral(output)
  }

  /** From a click: answers with a new message instead of updating the clicked one. */
  reply(output: Output): Output {
    return Reply(output)
  }
}
