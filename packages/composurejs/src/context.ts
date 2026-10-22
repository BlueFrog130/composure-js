import type { Entitlement, Interaction, Member, User } from "./discord.ts"
import { type Logger, serializeError } from "./log.ts"
import { Ephemeral, type EphemeralOutput, type Output } from "./response.ts"
import type { BindingsOf, DataOf, Env, Platform, VariablesOf } from "./types.ts"

export interface ContextInit<E extends Env, I extends Interaction> {
  interaction: I
  env: BindingsOf<E>
  data: DataOf<E>
  platform: Platform | undefined
  logger: Logger
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

  constructor(init: ContextInit<E, I>) {
    this.interaction = init.interaction
    this.env = init.env
    this.data = init.data
    this.#platform = init.platform
    this.#logger = init.logger
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
}
