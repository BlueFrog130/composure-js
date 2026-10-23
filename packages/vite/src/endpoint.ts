// Endpoint (ADR 0031): points the Dev Application at a connected Tunnel. Only the application
// named as `dev.application`, and only when it is the token's; only once the App answers through
// the tunnel, because Discord PINGs a new endpoint before accepting it.
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { isIPv6, type LookupFunction } from "node:net"
import { DiscordApiError, RateLimitedError, type Transport } from "composurejs"
import { BotClient, editCurrentApplication, getCurrentApplication } from "composurejs/rest"
import { elapsed, StageError, withinLimit } from "./stage.ts"
import type { Tunnel } from "./tunnel.ts"

/** The application fields pointed at the tunnel, each to this path under its URL. */
const ENDPOINT_FIELDS = { interactions_endpoint_url: "/interactions" } satisfies Record<string, string>

/** The probe must get its 401 within this. */
const PROBE_LIMIT = 30_000
const PROBE_INTERVAL = 1000
/** After a 400, retried once after this: past a 60 s DNS negative cache at Discord. */
const VERIFY_RETRY = 65_000

const HINT = "The endpoint must answer Discord's signed PING: check that the tunnel reaches this server and that DISCORD_PUBLIC_KEY is the Dev Application's."

export interface EndpointOptions {
  tunnel: Pick<Tunnel, "url" | "address">
  /** `dev.application`: the only application ever repointed. */
  application: string | undefined
  /** `DISCORD_TOKEN`. */
  token: string | undefined
  /** `DISCORD_PUBLIC_KEY`. */
  publicKey: string | undefined
  transport?: Transport | undefined
  info(message: string): void
  warn(message: string): void
  /** When the Dev Loop started: log lines carry the time since. */
  since?: number
  /** Tests: the probe's limit and interval, and the waits for 429s and the 400 retry. */
  probeLimit?: number
  probeInterval?: number
  sleep?: (ms: number) => Promise<void>
}

/**
 * Points the Dev Application's endpoint fields at the tunnel, or logs the URL to set by hand when
 * the token's application is not `dev.application`. Fails with a {@link StageError}: `probe`, `endpoint`.
 */
export async function pointEndpoint(options: EndpointOptions): Promise<void> {
  const { info, warn, since = Date.now(), sleep = wait } = options
  const base = options.tunnel.url.replace(/\/$/, "")
  const fields = Object.fromEntries(Object.entries(ENDPOINT_FIELDS).map(([field, path]) => [field, `${base}${path}`]))
  const endpoint = fields.interactions_endpoint_url!
  const byHand = `Set the Interactions Endpoint URL by hand: ${endpoint}`
  if (!options.token) return warn(`DISCORD_TOKEN is not set, so no application is repointed. ${byHand}`)
  if (!options.application) return warn(`dev.application is not set, so no application is repointed. ${byHand}`)

  // Every 429 comes back here, to be waited out in full.
  const client = new BotClient(options.token, { maxRateLimitWait: 0, ...(options.transport && { transport: options.transport }) })
  const patiently = async <T>(call: () => Promise<T>): Promise<T> => {
    for (;;) {
      try {
        return await call()
      } catch (error) {
        if (!(error instanceof RateLimitedError)) throw error
        info(`rate limited; retrying in ${error.retryAfter}s`)
        await sleep(error.retryAfter * 1000)
      }
    }
  }

  const me = await patiently(() => getCurrentApplication(client)).catch((error: unknown) => {
    throw new StageError("endpoint", `reading the token's application: ${(error as Error).message}`)
  })
  // Never repoint a production application: only the one named as the Dev Application.
  if (me.id !== options.application) {
    return warn(`dev.application (${options.application}) is not the token's application (${me.id}); not changing its endpoint. ${byHand}`)
  }

  await withinLimit("probe", options.probeLimit ?? PROBE_LIMIT, `401 from ${endpoint}`, async (observe, signal) => {
    for (;;) {
      const outcome = await probe(endpoint, options.tunnel.address, signal)
      if (outcome === 401) return
      observe(describeOutcome(outcome))
      if (signal.aborted) return
      await wait(options.probeInterval ?? PROBE_INTERVAL)
    }
  })
  info(`${endpoint} answers through the tunnel (${elapsed(since)})`)

  for (let retried = false; ; retried = true) {
    try {
      await patiently(() => editCurrentApplication(client, fields))
      break
    } catch (error) {
      if (!(error instanceof DiscordApiError && error.status === 400)) throw new StageError("endpoint", (error as Error).message)
      if (options.publicKey && me.verify_key !== options.publicKey) {
        throw new StageError("endpoint", `DISCORD_PUBLIC_KEY is not the public key of application ${me.id}, so the App rejects Discord's PING: use the Dev Application's.`)
      }
      if (retried) throw new StageError("endpoint", `${error.message}\n${HINT}`)
      info(`Discord could not verify ${endpoint}; retrying once in ${VERIFY_RETRY / 1000}s`)
      await sleep(VERIFY_RETRY)
    }
  }
  info(`Dev Application ${me.id} → ${endpoint} (${elapsed(since)})`)
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** One unsigned POST: the status, else the network error's code. Pinned to `address` when given. */
function probe(endpoint: string, address: string | undefined, signal: AbortSignal): Promise<number | string> {
  return new Promise((resolve) => {
    const url = new URL(endpoint)
    const send = url.protocol === "https:" ? httpsRequest : httpRequest
    const req = send(url, { method: "POST", headers: { "content-type": "application/json" }, timeout: 5000, signal, ...(address && { lookup: pinned(address) }) }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on("timeout", () => req.destroy(new Error("no answer within 5s")))
    req.on("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message))
    req.end("{}")
  })
}

/** A DNS lookup that answers `address` for any host. */
function pinned(address: string): LookupFunction {
  const family = isIPv6(address) ? 6 : 4
  return (_hostname, options, callback) => {
    if (options.all) (callback as unknown as (e: null, all: { address: string; family: number }[]) => void)(null, [{ address, family }])
    else callback(null, address, family)
  }
}

function describeOutcome(outcome: number | string): string {
  if (typeof outcome === "string") return outcome
  if (outcome === 530) return "HTTP 530: Cloudflare cannot route this hostname to a running tunnel"
  return `HTTP ${outcome}`
}
