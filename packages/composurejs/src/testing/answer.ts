import { type App, internals } from "../app.ts"
import { type Interaction, type InteractionResponse, MessageFlags } from "../discord.ts"
import { handleInteraction } from "../pipeline.ts"
import type { BindingsOf, DataOf, Env, Platform } from "../types.ts"
import type { Buildable } from "./builders.ts"
import { TestKey } from "./key.ts"

/** Background Work held until the test runs it. */
export class TestPlatform implements Required<Platform> {
  readonly #pending: Promise<unknown>[] = []

  waitUntil(promise: Promise<unknown>): void {
    this.#pending.push(promise)
  }

  get pending(): number {
    return this.#pending.length
  }

  /** Awaits all Background Work, including work it schedules; rethrows the first failure. */
  async runBackground(): Promise<void> {
    while (this.#pending.length > 0) await Promise.all(this.#pending.splice(0))
  }
}

export interface AnswerOptions<E extends Env> {
  env?: BindingsOf<E>
  /** Bot Data; default: the App's `data` loader run with `env`. */
  data?: DataOf<E>
  platform?: Platform
}

let sharedKey: Promise<TestKey> | undefined

/** Runs the App on `interaction` the way an Adapter does: signed request, full pipeline. */
export async function answer<E extends Env>(
  app: App<E>,
  interaction: Interaction | Buildable,
  options: AnswerOptions<E> = {},
): Promise<TestResponse> {
  const key = await (sharedKey ??= TestKey.generate())
  const env = (options.env ?? {}) as BindingsOf<E>
  const payload = "build" in interaction ? interaction.build() : interaction
  const request = await key.request(JSON.stringify(payload))
  const data = "data" in options ? (options.data as DataOf<E>) : await internals(app).loadData(env)
  const response = await handleInteraction(app, request, {
    credentials: { publicKey: key.publicKey },
    env,
    data,
    platform: options.platform ?? new TestPlatform(),
  })
  return TestResponse.from(response)
}

type Json = Record<string, unknown>

/** An HTTP answer with helpers for what Discord would show. */
export class TestResponse {
  private constructor(
    readonly status: number,
    /** The parsed JSON body, if any. */
    readonly body: InteractionResponse | undefined,
  ) {}

  static async from(response: Response): Promise<TestResponse> {
    const text = await response.text()
    const isJson = response.headers.get("content-type")?.includes("application/json")
    return new TestResponse(response.status, isJson && text ? (JSON.parse(text) as InteractionResponse) : undefined)
  }

  /** The interaction response type (4 message, 5 deferred, 7 update, ...). */
  get type(): number | undefined {
    return this.body?.type
  }

  get data(): Json | undefined {
    return (this.body as { data?: Json } | undefined)?.data
  }

  get flags(): number {
    return (this.data?.flags as number | undefined) ?? 0
  }

  get isEphemeral(): boolean {
    return (this.flags & MessageFlags.Ephemeral) !== 0
  }

  get components(): Json[] {
    return (this.data?.components as Json[] | undefined) ?? []
  }

  /** The message's text: its `content`, or every Text Display in order, joined by newlines. */
  get text(): string | undefined {
    const content = this.data?.content
    if (typeof content === "string") return content
    const texts: string[] = []
    const walk = (components: Json[]) => {
      for (const component of components) {
        if (typeof component.content === "string") texts.push(component.content)
        if (Array.isArray(component.components)) walk(component.components as Json[])
      }
    }
    walk(this.components)
    return texts.length > 0 ? texts.join("\n") : undefined
  }
}
