// The Dev Loop (ADR 0031): in `vite dev`, opens the Tunnel, points the Dev Application's endpoint
// at it (Endpoint), and syncs Commands to the dev guild on start and whenever the code changes.
// Serving the App is another plugin's: `server()`, or `@cloudflare/vite-plugin`.
import type { AddressInfo } from "node:net"
import type { ScopedDefinition, Transport } from "composurejs"
import { BotClient, getCurrentApplication } from "composurejs/rest"
import { apply, plan, summary } from "composurejs/sync"
import { type Plugin, runnerImport, type ViteDevServer } from "vite"
import { pointEndpoint } from "./endpoint.ts"
import { type Secrets, secretsOf, viteEnv } from "./env.ts"
import { appOf } from "./server.ts"
import { describeFailure, elapsed } from "./stage.ts"
import { openTunnel, type Tunnel, type TunnelOption } from "./tunnel.ts"

/**
 * The Dev Loop's settings, all here: nothing is read from the environment but the secrets
 * `DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY` and `CLOUDFLARE_TUNNEL_TOKEN` (Vite's env files for the
 * mode, e.g. `.env.local`, under the process environment).
 */
export interface DevOptions {
  /**
   * The Dev Application's id: the only application whose interactions endpoint is pointed at the
   * tunnel, and only when it is `DISCORD_TOKEN`'s. Unset: the URL to set by hand is printed.
   */
  application?: string
  /** dev Sync's guild: Commands are synced there on start and on every change. Unset: no dev Sync. */
  guild?: string
  /** Which tunnel to open. Default `"quick"`. See {@link TunnelOption}. */
  tunnel?: TunnelOption
  /** Tests only: REST requests to Discord. Under Vitest the Dev Loop runs only with this set. */
  transport?: Transport
}

const TAG = "\x1b[36m[composure]\x1b[0m"

/**
 * Sets the Tunnel, Endpoint and dev Sync up on a dev server. `appFile`: the module exporting the
 * App. `hoist` makes the plugin dev Sync loads the App with.
 */
export function setupDevLoop(server: ViteDevServer, dev: DevOptions, appFile: string, hoist: () => Plugin): void {
  const logger = server.config.logger
  const info = (msg: string) => logger.info(`${TAG} ${msg}`, { timestamp: true })
  const warn = (msg: string) => logger.warn(`${TAG} ${msg}`, { timestamp: true })
  const secrets = secretsOf(viteEnv(server.config))

  if (dev.guild) devSync(server, { guild: dev.guild, secrets, transport: dev.transport, appFile, hoist, info, warn })

  const option = dev.tunnel ?? "quick"
  if (option === false) return
  let tunnel: Tunnel | undefined
  let closed = false
  // Only once the server listens: the tunnel needs its port, and Discord PINGs a new endpoint.
  server.httpServer?.once("listening", () => {
    const since = Date.now()
    void (async () => {
      const { port } = server.httpServer!.address() as AddressInfo
      tunnel = await openTunnel(option, { port, root: server.config.root, tunnelToken: secrets.tunnelToken, info, warn })
      if (closed) return void tunnel.close()
      info(`tunnel connected ${tunnel.url} (${elapsed(since)})`)
      await pointEndpoint({ tunnel, application: dev.application, token: secrets.token, publicKey: secrets.publicKey, transport: dev.transport, info, warn, since })
    })().catch((error: unknown) => warn(describeFailure(error)))
  })
  server.httpServer?.once("close", () => {
    closed = true
    void tunnel?.close()
  })
}

interface DevSyncOptions {
  guild: string
  secrets: Secrets
  transport: Transport | undefined
  appFile: string
  hoist: () => Plugin
  info(message: string): void
  warn(message: string): void
}

/** dev Sync (ADR 0017): definitions read through Vite like the build, compared with what was last synced. */
function devSync(server: ViteDevServer, options: DevSyncOptions): void {
  const { guild, secrets, appFile, hoist, info, warn } = options
  const rest = options.transport ? { transport: options.transport } : {}
  let applicationId: string | undefined
  let last = ""
  let running: Promise<void> = Promise.resolve()
  const syncNow = () =>
    (running = running.then(async () => {
      const token = secrets.token
      if (!token) return warn("dev Sync needs DISCORD_TOKEN (in .env.local).")
      try {
        // The token's application: runs are serialized, so this is fetched once.
        applicationId ??= (await getCurrentApplication(new BotClient(token, rest))).id
        const config = { token, applicationId, scopes: {}, guild }
        const { module } = await runnerImport<Record<string, unknown>>(appFile, { root: server.config.root, plugins: [hoist()], logLevel: "error" })
        const definitions = appOf<{ fetch: unknown; definitions(): ScopedDefinition[] }>(module, appFile).definitions()
        const key = JSON.stringify(definitions)
        if (key === last) return
        const planned = await plan(definitions, config, rest)
        await apply(planned, config, rest)
        last = key
        info(`dev Sync to guild ${guild}: ${summary(planned)}`)
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
