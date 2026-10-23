// The Dev Loop (ADR 0017): `vite dev` serves the App (`server()`; Workers via @cloudflare/vite-plugin),
// opens a tunnel, points the *dev* application's interactions endpoint at it, and syncs Commands to a
// dev guild on start and whenever the code changes.
import type { AddressInfo } from "node:net"
import { createTracker, DiscordApiError, type ScopedDefinition, type Transport } from "composurejs"
import { BotClient, editCurrentApplication, getCurrentApplication } from "composurejs/rest"
import { apply, configFromEnv, plan, summary, type SyncConfig } from "composurejs/sync"
import { isRunnableDevEnvironment, loadEnv, type Plugin, runnerImport, type ViteDevServer } from "vite"
import { startNamedTunnel } from "./named-tunnel.ts"
import { appOf, send, toRequest } from "./server.ts"

export interface Tunnel {
  url: string
  close(): Promise<void>
}

/**
 * The Dev Loop's settings. Each value here wins over its environment variable (`.env` files for the
 * mode, then the process environment); the bot token is only ever read from the environment.
 */
export interface DevOptions {
  /**
   * Open a public tunnel to `vite dev` and point the dev application's interactions endpoint at
   * it. Default: when `applicationId`, `tunnelUrl` or `tunnelName` is set. Uses `tunnelUrl` when
   * set, else `startTunnel`, else a cloudflared quick tunnel (downloaded on first use, under
   * Cloudflare's terms).
   */
  tunnel?: boolean
  /**
   * The dev application: the only one whose interactions endpoint is repointed, and only when it
   * is the token's. Default: `COMPOSURE_DEV_APPLICATION_ID`.
   */
  applicationId?: string
  /**
   * Your own tunnel's public URL, used instead of a quick tunnel, its host allowed by Vite. With
   * `tunnelName` (or `COMPOSURE_DEV_TUNNEL_TOKEN`) the plugin runs that tunnel; without, it is one
   * you already run, forwarding to this server (ngrok, ...). Default: `COMPOSURE_DEV_TUNNEL_URL`.
   */
  tunnelUrl?: string
  /**
   * A named Cloudflare Tunnel routing `tunnelUrl`'s host to this server: the plugin runs it with
   * cloudflared (installed, and logged in with `cloudflared tunnel login`; or the tunnel's token in
   * `COMPOSURE_DEV_TUNNEL_TOKEN`). Default: `COMPOSURE_DEV_TUNNEL_NAME`.
   */
  tunnelName?: string
  /** Sync Commands to `guild` on start and on every change. Default: when `guild` is set. */
  sync?: boolean
  /** The guild dev Sync syncs Commands to. Default: `COMPOSURE_DEV_GUILD`, else `DISCORD_GUILD_ID`. */
  guild?: string
  /**
   * Another tunnel (ngrok, a fixed hostname, ...): given the local port, resolves to its public URL.
   * Add its hostname to Vite's `server.allowedHosts`, or Vite blocks its requests.
   */
  startTunnel?: (port: number) => Promise<Tunnel>
  /** REST requests to Discord (tests). Default `fetch`. */
  transport?: Transport
}

export const DEV_APPLICATION_VAR = "COMPOSURE_DEV_APPLICATION_ID"
export const DEV_GUILD_VAR = "COMPOSURE_DEV_GUILD"
/** A developer's own tunnel (a fixed hostname already forwarding to `vite dev`): used instead of a quick tunnel. */
export const DEV_TUNNEL_URL_VAR = "COMPOSURE_DEV_TUNNEL_URL"
export const DEV_TUNNEL_NAME_VAR = "COMPOSURE_DEV_TUNNEL_NAME"
/** A named tunnel's token: runs it without `cloudflared tunnel login`. A secret, so never an option. */
export const DEV_TUNNEL_TOKEN_VAR = "COMPOSURE_DEV_TUNNEL_TOKEN"

const TAG = "\x1b[36m[composure]\x1b[0m"
/** Waits between attempts to point the dev application at an endpoint Discord cannot verify yet: past a 60s DNS negative cache. */
const ENDPOINT_RETRY_DELAYS = [2000, 4000, 8000, 16000, 30000]

/** `dev.tunnelUrl`, else `COMPOSURE_DEV_TUNNEL_URL`; an empty value is none. */
export function tunnelUrlOf(options: DevOptions, env: Record<string, string | undefined>): string | undefined {
  return (options.tunnelUrl ?? env[DEV_TUNNEL_URL_VAR]) || undefined
}

/** `.env` files for the mode, then the process environment. */
function devEnv(server: ViteDevServer): Record<string, string | undefined> {
  const { root, mode, envDir } = server.config
  return { ...loadEnv(mode, envDir === false ? root : (envDir ?? root), ""), ...process.env }
}

/** `server()` in `vite dev`: answers requests with the App in `appFile`, reloaded through Vite. */
export function serveInDev(server: ViteDevServer, appFile: string): void {
  const env = devEnv(server)
  const platform = createTracker()
  server.middlewares.use((req, res, next) => {
    if (req.method !== "POST" && req.url !== "/health") return next()
    if (req.url === "/health") return void res.writeHead(200, { "content-type": "text/plain" }).end("ok")
    void (async () => {
      const ssr = server.environments.ssr
      if (!isRunnableDevEnvironment(ssr)) throw new Error("The ssr environment is not runnable in this process")
      const app = appOf<LoadedApp>(await ssr.runner.import(appFile), appFile)
      const request = await toRequest(req)
      await send(res, request ? await app.fetch(request, env, platform) : new Response("Payload Too Large", { status: 413 }))
    })().catch((error: unknown) => {
      server.ssrFixStacktrace(error as Error)
      server.config.logger.error(`${TAG} ${(error as Error).stack ?? String(error)}`)
      if (!res.headersSent) res.writeHead(500).end("Internal Server Error")
    })
  })
}

/**
 * Sets the tunnel and dev Sync up on a dev server; whatever serves the App (`server()`,
 * `@cloudflare/vite-plugin`) is another plugin. `appFile`: the module exporting the App. `hoist`
 * makes the plugin dev Sync loads the App with.
 */
export function setupDevLoop(server: ViteDevServer, options: DevOptions, appFile: string, hoist: () => Plugin): void {
  const root = server.config.root
  const logger = server.config.logger
  const info = (msg: string) => logger.info(`${TAG} ${msg}`, { timestamp: true })
  const warn = (msg: string) => logger.warn(`${TAG} ${msg}`, { timestamp: true })
  const env = devEnv(server)
  const rest = options.transport ? { transport: options.transport } : {}

  let config: SyncConfig | undefined | null
  const discord = () => {
    if (config !== undefined) return config ?? undefined
    try {
      return (config = configFromEnv(env))
    } catch (error) {
      config = null
      warn(`${(error as Error).message}: tunnel and dev Sync need the bot token (DISCORD_TOKEN in .env or .dev.vars).`)
      return undefined
    }
  }

  // Dev Sync: definitions are read through Vite like the build, compared with what was last synced.
  const devGuild = options.guild ?? env[DEV_GUILD_VAR] ?? env.DISCORD_GUILD_ID
  if (options.sync ?? devGuild !== undefined) {
    let last = ""
    let running: Promise<void> = Promise.resolve()
    const syncNow = () =>
      (running = running.then(async () => {
        const cfg = discord()
        if (!cfg) return
        if (!devGuild) return warn(`dev Sync needs ${DEV_GUILD_VAR} (or dev.guild): the guild to sync Commands to while developing.`)
        try {
          const { module } = await runnerImport<Record<string, unknown>>(appFile, { root, plugins: [hoist()], logLevel: "error" })
          const definitions = appOf<LoadedApp>(module, appFile).definitions()
          const key = JSON.stringify(definitions)
          if (key === last) return
          const planned = await plan(definitions, { ...cfg, guild: devGuild }, rest)
          await apply(planned, { ...cfg, guild: devGuild }, rest)
          last = key
          info(`dev Sync to guild ${devGuild}: ${summary(planned)}`)
        } catch (error) {
          warn(`dev Sync failed: ${(error as Error).message}`)
        }
      }))
    let timer: ReturnType<typeof setTimeout> | undefined
    server.watcher.on("change", (file) => {
      if (!/\.[cm]?[jt]sx?$/.test(file) || file.includes("node_modules")) return
      clearTimeout(timer)
      timer = setTimeout(syncNow, 300)
    })
    void syncNow()
  }

  // Tunnel: only once the server listens, because Discord PINGs a new endpoint before accepting it.
  const devApp = options.applicationId ?? env[DEV_APPLICATION_VAR]
  const ownTunnel = tunnelUrlOf(options, env)
  const tunnelName = (options.tunnelName ?? env[DEV_TUNNEL_NAME_VAR]) || undefined
  const tunnelToken = env[DEV_TUNNEL_TOKEN_VAR] || undefined
  const openTunnel = async (port: number): Promise<Tunnel> => {
    if (tunnelName || tunnelToken) {
      if (!ownTunnel) throw new Error(`a named tunnel needs ${DEV_TUNNEL_URL_VAR} (or dev.tunnelUrl): the public URL it routes to this server`)
      return startNamedTunnel({ url: ownTunnel, port, name: tunnelName, token: tunnelToken, warn })
    }
    if (ownTunnel) return { url: ownTunnel, close: async () => {} }
    return (options.startTunnel ?? cloudflared)(port)
  }
  if (options.tunnel ?? (devApp !== undefined || ownTunnel !== undefined || tunnelName !== undefined)) {
    let tunnel: Tunnel | undefined
    server.httpServer?.once("listening", () => {
      void (async () => {
        const { port } = server.httpServer!.address() as AddressInfo
        tunnel = await openTunnel(port)
        const endpoint = `${tunnel.url.replace(/\/$/, "")}/interactions`
        info(`tunnel: ${tunnel.url}`)
        const cfg = discord()
        if (!cfg) return
        // Never repoint a production application: only the one named as the dev application.
        if (devApp !== cfg.applicationId) {
          warn(
            devApp
              ? `The dev application (${devApp}) is not the token's application (${cfg.applicationId}); not changing its endpoint. Set the Interactions Endpoint URL by hand: ${endpoint}`
              : `Set ${DEV_APPLICATION_VAR}=${cfg.applicationId} (or dev.applicationId) to point this (dev!) application at the tunnel, or set its Interactions Endpoint URL by hand: ${endpoint}`,
          )
          return
        }
        // A quick tunnel's hostname resolves only seconds after cloudflared prints it, and a resolver
        // caches the miss (60s for trycloudflare.com): Discord's first lookup must come after ours.
        const reached = await untilReachable(endpoint)
        if (reached !== true) warn(`${endpoint} does not reach this server (${reached}); asking Discord anyway`)
        // Discord PINGs the endpoint before accepting it, and answers 400 when that fails.
        const client = new BotClient(cfg.token, rest)
        for (let attempt = 0; ; attempt++) {
          try {
            await editCurrentApplication(client, { interactions_endpoint_url: endpoint })
            break
          } catch (error) {
            if (!(error instanceof DiscordApiError && error.status === 400)) throw error
            const delay = ENDPOINT_RETRY_DELAYS[attempt]
            if (delay === undefined) throw new Error(`${error.message}\n${await verifyHint(client, env)}`)
            info(`Discord could not verify ${endpoint} yet; retrying in ${delay / 1000}s`)
            await sleep(delay)
          }
        }
        info(`interactions endpoint of application ${cfg.applicationId} → ${endpoint}`)
      })().catch((error: unknown) => warn(`tunnel failed: ${(error as Error).message}`))
    })
    server.httpServer?.once("close", () => void tunnel?.close())
  }
}

interface LoadedApp {
  fetch(request: Request, env?: unknown, platform?: unknown): Promise<Response>
  definitions(): ScopedDefinition[]
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls the endpoint until the App answers an unsigned request (401): true, else the last outcome. */
async function untilReachable(endpoint: string, ms = 60_000): Promise<true | string> {
  let last = ""
  for (const start = Date.now(); Date.now() - start < ms; await sleep(1000)) {
    try {
      const res = await fetch(endpoint, { method: "POST", body: "{}", signal: AbortSignal.timeout(5000) })
      if (res.status === 401) return true
      last = res.status === 530 ? "HTTP 530: Cloudflare cannot route this hostname to a running tunnel; check its DNS record and route" : `HTTP ${res.status}`
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause
      last = cause?.code ?? (error as Error).message
    }
  }
  return last
}

/** Why Discord's signed PING keeps failing: most often a public key from another application. */
async function verifyHint(client: BotClient, env: Record<string, string | undefined>): Promise<string> {
  const publicKey = env.DISCORD_PUBLIC_KEY
  const application = await getCurrentApplication(client).catch(() => undefined)
  if (publicKey && application && application.verify_key !== publicKey) {
    return `DISCORD_PUBLIC_KEY is not the public key of application ${application.id}, so the App rejects Discord's PING.`
  }
  return "The endpoint must answer Discord's signed PING: check that it reaches this server and that the App's DISCORD_PUBLIC_KEY is the dev application's."
}

async function cloudflared(port: number): Promise<Tunnel> {
  const { startTunnel } = await import("untun")
  const tunnel = await startTunnel({ port, hostname: "localhost", acceptCloudflareNotice: true })
  if (!tunnel) throw new Error("cloudflared did not start")
  return { url: await tunnel.getURL(), close: () => tunnel.close() }
}
