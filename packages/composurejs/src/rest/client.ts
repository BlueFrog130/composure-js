// REST over an injectable Transport (ADR 0006). Rate limits are reactive only: a 429 is waited
// out when Discord asks for less than `maxRateLimitWait`, otherwise it is thrown.
import type { Upload } from "../components.ts"
import { DiscordApiError, RateLimitedError } from "../errors.ts"
import { type Logger, consoleLogger } from "../log.ts"
import { DISCORD_API, fetchTransport, formData, type Transport } from "../transport.ts"
import type { operations } from "./schema.d.ts"

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
export type Op = keyof operations

/** One Endpoint: method and path template exactly as in Discord's OpenAPI spec, plus its operationId. */
export interface Route<O extends Op = Op> {
  readonly method: Method
  readonly path: string
  readonly op: O
}

export function route<O extends Op>(method: Method, path: string, op: O): Route<O> {
  return { method, path, op }
}

type JsonOf<T> = T extends { content: { "application/json": infer B } } ? B : never
/** The JSON request body of operation `O`. */
export type RequestBody<O extends Op> = operations[O] extends { requestBody?: infer R } ? JsonOf<NonNullable<R>> : never
/** The JSON response of operation `O`; `undefined` for 204s. */
export type ResponseBody<O extends Op> = operations[O]["responses"] extends infer R
  ? R extends { 200: infer S } ? JsonOf<S>
    : R extends { 201: infer S } ? JsonOf<S>
    : undefined
  : never
/** The query parameters of operation `O`. */
export type Query<O extends Op> = operations[O]["parameters"] extends { query?: infer Q } ? { [K in keyof NonNullable<Q>]?: NonNullable<Q>[K] | undefined } : never

export interface RestOptions {
  /** Default `fetch`. */
  transport?: Transport | undefined
  /** Longest 429 wait, in ms, before throwing {@link RateLimitedError}. Default 2000 (Sync uses 60000). */
  maxRateLimitWait?: number | undefined
  logger?: Logger | undefined
  /** Default `https://discord.com/api/v10`. */
  apiBase?: string | undefined
}

export interface RequestInit {
  /** Path parameters by name, as in the template. */
  params?: Record<string, string>
  query?: Record<string, string | number | boolean | undefined> | undefined
  /** A JSON body. */
  body?: unknown
  /** Files: the body is sent as multipart, `payload_json` plus `files[n]`. */
  files?: readonly Upload[] | undefined
  /** `X-Audit-Log-Reason`. */
  reason?: string | undefined
  /** A prebuilt multipart body, sent as is. */
  multipart?: FormData | undefined
}

const USER_AGENT = "DiscordBot (https://github.com/BlueFrog130/composure-js, 0.0.0)"
const MAX_ATTEMPTS = 3

/** Sends requests to Discord; the Bot and Interaction Clients build on it. */
export class RestClient {
  readonly #authorization: string | undefined
  readonly #transport: Transport
  readonly #maxWait: number
  readonly #logger: Logger
  readonly #base: string

  constructor(authorization: string | undefined, options: RestOptions = {}) {
    this.#authorization = authorization
    this.#transport = options.transport ?? fetchTransport
    this.#maxWait = options.maxRateLimitWait ?? 2000
    this.#logger = options.logger ?? consoleLogger
    this.#base = options.apiBase ?? DISCORD_API
  }

  /** Sends one request to `route`, decoding the JSON response (`undefined` for 204). */
  async request<O extends Op>(route: Route<O>, init: RequestInit = {}): Promise<ResponseBody<O>> {
    const template = `${route.method} ${route.path}`
    const url = this.#base + fillPath(route.path, init.params ?? {}) + queryString(init.query)

    for (let attempt = 1; ; attempt++) {
      const headers = new Headers({ "User-Agent": USER_AGENT })
      if (this.#authorization) headers.set("Authorization", this.#authorization)
      if (init.reason) headers.set("X-Audit-Log-Reason", encodeURIComponent(init.reason))
      let body: BodyInit | undefined
      if (init.multipart) body = init.multipart
      else if (init.files?.length) body = formData(init.body ?? {}, init.files)
      else if (init.body !== undefined) {
        headers.set("Content-Type", "application/json")
        body = JSON.stringify(init.body)
      }

      const response = await this.#transport(new Request(url, { method: route.method, headers, ...(body !== undefined && { body }) }))
      this.#logger.debug({ msg: "REST response", route: template, status: response.status })

      if (response.status === 429) {
        const limit = (await readJson(response)) as { retry_after?: number; global?: boolean } | undefined
        const retryAfter = limit?.retry_after ?? Number(response.headers.get("Retry-After") ?? 1)
        const global = limit?.global ?? false
        if (retryAfter * 1000 > this.#maxWait || attempt >= MAX_ATTEMPTS) {
          this.#logger.warn({ msg: "Rate limited; giving up", route: template, retryAfter, global })
          throw new RateLimitedError(template, retryAfter, global)
        }
        this.#logger.debug({ msg: "Rate limited; waiting", route: template, retryAfter })
        await sleep(retryAfter * 1000)
        continue
      }
      if (!response.ok) {
        const error = (await readJson(response)) as { code?: number; message?: string; errors?: unknown } | undefined
        throw new DiscordApiError(response.status, error?.code, template, error?.errors, error?.message ?? response.statusText)
      }
      return (response.status === 204 ? undefined : await readJson(response)) as ResponseBody<O>
    }
  }
}

/** REST authorized by the bot token: `c.bot`. */
export class BotClient extends RestClient {
  constructor(token: string, options: RestOptions = {}) {
    super(`Bot ${token}`, options)
  }
}

function fillPath(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name]
    if (value === undefined) throw new Error(`Missing path parameter "${name}" for ${template}`)
    return encodeURIComponent(value)
  })
}

function queryString(query: RequestInit["query"]): string {
  if (!query) return ""
  const entries = Object.entries(query).filter(([, v]) => v !== undefined) as [string, string | number | boolean][]
  return entries.length > 0 ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : ""
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
