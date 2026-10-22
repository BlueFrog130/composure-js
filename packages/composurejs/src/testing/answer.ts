import { type App, internals } from "../app.ts"
import { type Interaction, type InteractionResponse, MessageFlags } from "../discord.ts"
import { handleInteraction } from "../pipeline.ts"
import type { Transport } from "../transport.ts"
import type { BindingsOf, DataOf, Env, Platform } from "../types.ts"
import type { Buildable } from "./builders.ts"
import { TestKey } from "./key.ts"
import { MockTransport, type RecordedFile } from "./transport.ts"

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
  /** Default: a fresh {@link MockTransport}, so tests never reach Discord. */
  transport?: MockTransport | Transport
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
  const mock = options.transport instanceof MockTransport ? options.transport : options.transport ? undefined : new MockTransport()
  const response = await handleInteraction(app, request, {
    credentials: { publicKey: key.publicKey },
    env,
    data,
    platform: options.platform ?? new TestPlatform(),
    transport: mock?.fetch ?? (options.transport as Transport),
  })
  // A 202 means the answer went through the callback endpoint (it carried files).
  const callback = response.status === 202 ? mock?.requests.findLast((r) => r.path.endsWith("/callback")) : undefined
  return callback ? TestResponse.of(202, callback.json as InteractionResponse, callback.files) : TestResponse.from(response)
}

type Json = Record<string, unknown>

/** An HTTP answer with helpers for what Discord would show. */
export class TestResponse {
  private constructor(
    readonly status: number,
    /** The parsed JSON body, or for a 202 the payload sent through the callback endpoint. */
    readonly body: InteractionResponse | undefined,
    /** Files sent with the answer. */
    readonly files: RecordedFile[],
  ) {}

  static async from(response: Response): Promise<TestResponse> {
    const text = await response.text()
    const isJson = response.headers.get("content-type")?.includes("application/json")
    return new TestResponse(response.status, isJson && text ? (JSON.parse(text) as InteractionResponse) : undefined, [])
  }

  static of(status: number, body: InteractionResponse | undefined, files: RecordedFile[] = []): TestResponse {
    return new TestResponse(status, body, files)
  }

  /** The interaction response type (4 message, 5 deferred, 7 update, 9 modal, ...). */
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

  /** Every component in the tree, depth first: rows, buttons, accessories, Label inputs, ... */
  get allComponents(): Json[] {
    const out: Json[] = []
    const walk = (c: Json) => {
      out.push(c)
      for (const child of (c.components as Json[] | undefined) ?? []) walk(child)
      if (c.accessory) walk(c.accessory as Json)
      if (c.component) walk(c.component as Json)
    }
    this.components.forEach(walk)
    return out
  }

  /** The message's text: its `content`, or every Text Display in order, joined by newlines. */
  get text(): string | undefined {
    const content = this.data?.content
    if (typeof content === "string") return content
    const texts = this.allComponents.filter((c) => c.type === 10).map((c) => c.content as string)
    return texts.length > 0 ? texts.join("\n") : undefined
  }

  /** The component with this `custom_id`, if any. */
  component(customId: string): Json | undefined {
    return this.allComponents.find((c) => c.custom_id === customId)
  }
}
