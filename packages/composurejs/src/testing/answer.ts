import { type App, internals } from "../app.ts"
import { type Interaction, type InteractionResponse, MessageFlags } from "../discord.ts"
import { handleInteraction } from "../pipeline.ts"
import type { Transport } from "../transport.ts"
import type { BindingsOf, DataOf, Env, Platform } from "../types.ts"
import { type Buildable, component, type ComponentBuilder, modalSubmit, type ModalSubmitBuilder, type SubmittedValue } from "./builders.ts"
import { TestKey } from "./key.ts"
import { MockTransport, type RecordedFile, type RecordedRequest } from "./transport.ts"

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

/** Runs the App on `interaction` the way a platform does: signed request, full pipeline. */
export async function answer<E extends Env>(app: App<E>, interaction: Interaction | Buildable, options: AnswerOptions<E> = {}): Promise<TestResponse> {
  const key = await (sharedKey ??= TestKey.generate())
  const env = (options.env ?? {}) as BindingsOf<E>
  const payload = "build" in interaction ? interaction.build() : interaction
  const request = await key.request(JSON.stringify(payload))
  const data = "data" in options ? (options.data as DataOf<E>) : await internals(app).loadData(env)
  const mock = options.transport instanceof MockTransport ? options.transport : options.transport ? undefined : new MockTransport()
  const platform = options.platform ?? new TestPlatform()
  const response = await handleInteraction(app, request, {
    credentials: { publicKey: key.publicKey, token: "test-bot-token" },
    env,
    data,
    platform,
    transport: mock?.fetch ?? (options.transport as Transport),
  })
  // A 202 means the answer went through the callback endpoint (it carried files).
  const callback = response.status === 202 ? mock?.requests.findLast((r) => r.path.endsWith("/callback")) : undefined
  const res = callback ? TestResponse.of(202, callback.json as InteractionResponse, callback.files, payload) : await TestResponse.from(response, payload)
  return res.withRuntime(mock, platform)
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
    /** The Interaction this answers. */
    readonly interaction: Interaction | undefined,
  ) {}

  static async from(response: Response, interaction?: Interaction): Promise<TestResponse> {
    const text = await response.text()
    const isJson = response.headers.get("content-type")?.includes("application/json")
    return new TestResponse(response.status, isJson && text ? (JSON.parse(text) as InteractionResponse) : undefined, [], interaction)
  }

  #transport: MockTransport | undefined
  #platform: Platform | undefined

  /** @internal */
  withRuntime(transport: MockTransport | undefined, platform: Platform): this {
    this.#transport = transport
    this.#platform = platform
    return this
  }

  /** The MockTransport the App sent REST requests through (unless the test passed its own Transport). */
  get transport(): MockTransport {
    if (!this.#transport) throw new Error("This answer used the Transport the test passed in")
    return this.#transport
  }

  /** Runs the Background Work (deferred edits, follow-ups) and returns every REST request sent so far. */
  async settle(): Promise<RecordedRequest[]> {
    if (this.#platform instanceof TestPlatform) await this.#platform.runBackground()
    return this.transport.requests
  }

  static of(status: number, body: InteractionResponse | undefined, files: RecordedFile[] = [], interaction?: Interaction): TestResponse {
    return new TestResponse(status, body, files, interaction)
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

  /** A click on the button with this label or `custom_id`, on the message this response shows. */
  click(labelOrId: string): ComponentBuilder {
    const buttons = this.allComponents.filter((c) => c.type === 2)
    const button = buttons.find((c) => c.custom_id === labelOrId) ?? buttons.find((c) => c.label === labelOrId)
    if (!button || typeof button.custom_id !== "string") {
      throw new Error(`No clickable button "${labelOrId}"; buttons: ${buttons.map((b) => String(b.label ?? b.custom_id ?? b.url)).join(", ") || "none"}`)
    }
    if (button.disabled) throw new Error(`Button "${labelOrId}" is disabled`)
    return component(button.custom_id).onMessage(this.#message())
  }

  /** Choosing `values` in the select with this `custom_id` or placeholder. */
  select(idOrPlaceholder: string, values: string[]): ComponentBuilder {
    const selects = this.allComponents.filter((c) => [3, 5, 6, 7, 8].includes(c.type as number))
    const select = selects.find((c) => c.custom_id === idOrPlaceholder) ?? selects.find((c) => c.placeholder === idOrPlaceholder)
    if (!select) throw new Error(`No select "${idOrPlaceholder}"; selects: ${selects.map((s) => String(s.custom_id)).join(", ") || "none"}`)
    return component(select.custom_id as string)
      .values(values, select.type as number)
      .onMessage(this.#message())
  }

  /** Submitting the modal this response opens, with values by input `custom_id`. */
  submit(values: Record<string, SubmittedValue> = {}): ModalSubmitBuilder {
    if (this.type !== 9) throw new Error(`submit() needs a modal response (type 9), this is type ${String(this.type)}`)
    const inputs = new Set(this.allComponents.map((c) => c.custom_id).filter((id) => typeof id === "string"))
    const builder = modalSubmit(this.data!.custom_id as string)
    for (const [id, value] of Object.entries(values)) {
      if (!inputs.has(id)) throw new Error(`The modal has no input "${id}"; inputs: ${[...inputs].join(", ")}`)
      builder.field(id, value)
    }
    const message = (this.interaction as { message?: Json } | undefined)?.message
    return message ? builder.onMessage(message) : builder
  }

  #message(): Json {
    return { components: this.components, flags: this.flags }
  }

  /** The component with this `custom_id`, if any. */
  component(customId: string): Json | undefined {
    return this.allComponents.find((c) => c.custom_id === customId)
  }
}

/** A Webhook Event body as Discord sends it (`type` 1), or its PING (`webhookPing()`). */
export function webhookEvent(type: string, data: unknown, timestamp = new Date().toISOString()): Record<string, unknown> {
  return { version: 1, application_id: "1052322265397739523", type: 1, event: { type, timestamp, data } }
}

export function webhookPing(): Record<string, unknown> {
  return { version: 1, application_id: "1052322265397739523", type: 0 }
}

export interface EventResult {
  status: number
  /** REST requests the Event Handler made. */
  requests: RecordedRequest[]
}

/** Delivers a signed Webhook Event to the App's events path and runs its handler. */
export async function sendEvent<E extends Env>(app: App<E>, body: unknown, options: AnswerOptions<E> & { path?: string } = {}): Promise<EventResult> {
  const key = await (sharedKey ??= TestKey.generate())
  const env = (options.env ?? {}) as BindingsOf<E>
  const request = await key.request(JSON.stringify(body), { url: `https://bot.test${options.path ?? "/events"}` })
  const data = "data" in options ? (options.data as DataOf<E>) : await internals(app).loadData(env)
  const mock = options.transport instanceof MockTransport ? options.transport : new MockTransport()
  const platform = options.platform ?? new TestPlatform()
  const response = await handleInteraction(app, request, {
    credentials: { publicKey: key.publicKey, token: "test-bot-token" },
    env,
    data,
    platform,
    transport: mock.fetch,
  })
  if (platform instanceof TestPlatform) await platform.runBackground()
  return { status: response.status, requests: mock.requests }
}
