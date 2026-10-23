// REST over an injectable Transport (ADR 0006). Rate limits: each bucket's remaining count is
// tracked per isolate from Discord's headers, so a request waits before it would be limited, and a
// 429 is still waited out; a wait longer than `maxRateLimitWait` throws instead. Requests that are
// safe to repeat (not POST) are retried on network errors, timeouts and 5xx.
import type { Upload } from "../components.ts"
import { DiscordApiError, RateLimitedError, RequestTimeoutError } from "../errors.ts"
import { defaultLogger, type Logger } from "../log.ts"
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
  ? R extends { 200: infer S }
    ? JsonOf<S>
    : R extends { 201: infer S }
      ? JsonOf<S>
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
  /** Longest wait for one attempt's response, in ms, before {@link RequestTimeoutError}. Default 10000. */
  timeout?: number | undefined
  /** @internal The Owning Route Views sent through this client mark their handlers with (ADR 0026). */
  route?: string | undefined
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

declare const __COMPOSURE_VERSION__: string | undefined
const VERSION = typeof __COMPOSURE_VERSION__ === "string" ? __COMPOSURE_VERSION__ : "dev"
const USER_AGENT = `DiscordBot (https://github.com/BlueFrog130/composure-js, ${VERSION})`
/** 429s waited out per request before giving up. */
const MAX_LIMITED = 2
/** Delays before retrying a request that is safe to repeat, after a network error, timeout or 5xx. */
const RETRY_DELAYS = [250, 1000]
const RETRY_STATUS = new Set([500, 502, 503, 504])
/** Path parameters that give a route its own rate limit bucket. */
const MAJOR_PARAMS = ["channel_id", "guild_id", "webhook_id", "webhook_token"]

// Per isolate: the bucket each route is in, and each bucket's state (ADR 0006).
const bucketOfRoute = new Map<string, string>()
const buckets = new Map<string, { remaining: number; resetAt: number }>()
const MAX_TRACKED = 500

/** Sends requests to Discord; the Bot and Interaction Clients build on it. */
export class RestClient {
  readonly #authorization: string | undefined
  readonly #transport: Transport
  readonly #maxWait: number
  readonly #logger: Logger
  readonly #base: string
  readonly #timeout: number
  /** @internal The Owning Route of Views sent through this client. */
  readonly route: string | undefined

  constructor(authorization: string | undefined, options: RestOptions = {}) {
    this.#authorization = authorization
    this.#transport = options.transport ?? fetchTransport
    this.#maxWait = options.maxRateLimitWait ?? 2000
    this.#logger = options.logger ?? defaultLogger()
    this.#base = options.apiBase ?? DISCORD_API
    this.#timeout = options.timeout ?? 10_000
    this.route = options.route
  }

  /** Sends one request to `route`, decoding the JSON response (`undefined` for 204). */
  async request<O extends Op>(route: Route<O>, init: RequestInit = {}): Promise<ResponseBody<O>> {
    const template = `${route.method} ${route.path}`
    const url = this.#base + fillPath(route.path, init.params ?? {}) + queryString(init.query)
    const repeatable = route.method !== "POST"
    const auth = this.#authorization ?? "-"
    const routeKey = `${auth} ${template}`
    const major = MAJOR_PARAMS.map((name) => init.params?.[name] ?? "").join("/")
    const bucketKey = () => `${auth} ${bucketOfRoute.get(routeKey) ?? template} ${major}`
    let limited = 0
    let retries = 0

    for (;;) {
      const wait = waitFor(bucketKey())
      if (wait > this.#maxWait) {
        this.#logger.warn({ msg: "Rate limit bucket used up; giving up", route: template, retryAfter: wait / 1000 })
        throw new RateLimitedError(template, wait / 1000, false)
      }
      if (wait > 0) await sleep(wait)

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

      let response: Response
      try {
        response = await this.#send(url, { method: route.method, headers, ...(body !== undefined && { body }) }, template)
      } catch (error) {
        const delay = RETRY_DELAYS[retries]
        if (!repeatable || delay === undefined) throw error
        retries++
        this.#logger.debug({ msg: "REST request failed; retrying", route: template, error: (error as Error).message })
        await sleep(delay)
        continue
      }
      this.#logger.debug({ msg: "REST response", route: template, status: response.status })
      track(routeKey, bucketKey, response.headers)

      const delay = RETRY_DELAYS[retries]
      if (RETRY_STATUS.has(response.status) && repeatable && delay !== undefined) {
        retries++
        await response.body?.cancel()
        this.#logger.debug({ msg: "Discord answered 5xx; retrying", route: template, status: response.status })
        await sleep(delay)
        continue
      }
      if (response.status === 429) {
        const limit = (await readJson(response)) as { retry_after?: number; global?: boolean } | undefined
        const retryAfter = limit?.retry_after ?? Number(response.headers.get("Retry-After") ?? 1)
        const global = limit?.global ?? false
        if (retryAfter * 1000 > this.#maxWait || ++limited > MAX_LIMITED) {
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

  /** One attempt, bounded by the timeout. The signal aborts `fetch`; the race covers Transports that ignore it. */
  async #send(url: string, init: globalThis.RequestInit, template: string): Promise<Response> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new RequestTimeoutError(template, this.#timeout))
      }, this.#timeout)
    })
    try {
      return await Promise.race([this.#transport(new Request(url, { ...init, signal: controller.signal })), timedOut])
    } finally {
      clearTimeout(timer)
    }
  }
}

/** How long a request must wait for its bucket, in ms: 0 unless the bucket is used up. */
function waitFor(key: string): number {
  const state = buckets.get(key)
  if (!state || state.remaining > 0) return 0
  return Math.max(0, state.resetAt - Date.now())
}

/** Records a response's `X-RateLimit-*` headers for its bucket. */
function track(routeKey: string, bucketKey: () => string, headers: Headers): void {
  const bucket = headers.get("X-RateLimit-Bucket")
  if (bucket) bucketOfRoute.set(routeKey, bucket)
  const remaining = headers.get("X-RateLimit-Remaining")
  const resetAfter = headers.get("X-RateLimit-Reset-After")
  if (remaining === null || resetAfter === null) return
  const now = Date.now()
  buckets.set(bucketKey(), { remaining: Number(remaining), resetAt: now + Number(resetAfter) * 1000 })
  // Interaction tokens make many short-lived buckets on a long-running server: forget expired ones.
  if (buckets.size > MAX_TRACKED) for (const [key, state] of buckets) if (state.resetAt <= now) buckets.delete(key)
  if (bucketOfRoute.size > MAX_TRACKED) bucketOfRoute.clear()
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
