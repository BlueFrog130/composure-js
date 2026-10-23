// The Dev Loop (ADR 0031): in `vite dev`, opens the Tunnel, points the Dev Application's endpoint
// at it (Endpoint), and syncs Commands to the dev guild on start and whenever the code changes.
// Serving the App is another plugin's: `server()`, or `@cloudflare/vite-plugin`.
import type { AddressInfo } from "node:net"
import type { Transport } from "composurejs"
import type { Plugin, ViteDevServer } from "vite"
import { startDevSync } from "./dev-sync.ts"
import { pointEndpoint } from "./endpoint.ts"
import { secretsOf, viteEnv } from "./env.ts"
import { describeFailure, elapsed, withinLimit } from "./stage.ts"
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
/** The tunnel must connect within this. */
const CONNECT_LIMIT = 30_000

/**
 * Sets the Tunnel, Endpoint and dev Sync up on a dev server. `appFile`: the module exporting the
 * App. `hoist` makes the plugin dev Sync loads the App with.
 */
export function setupDevLoop(server: ViteDevServer, dev: DevOptions, appFile: string, hoist: () => Plugin): void {
  const logger = server.config.logger
  const info = (msg: string) => logger.info(`${TAG} ${msg}`, { timestamp: true })
  const warn = (msg: string) => logger.warn(`${TAG} ${msg}`, { timestamp: true })
  const secrets = secretsOf(viteEnv(server.config))

  if (dev.guild) startDevSync(server, { guild: dev.guild, token: secrets.token, transport: dev.transport, appFile, plugin: hoist, info, warn })

  const option = dev.tunnel ?? "quick"
  if (option === false) return
  let tunnel: Tunnel | undefined
  let closed = false
  // Only once the server listens: the tunnel needs its port, and Discord PINGs a new endpoint.
  server.httpServer?.once("listening", () => {
    const since = Date.now()
    void (async () => {
      const { port } = server.httpServer!.address() as AddressInfo
      tunnel = await withinLimit(
        "tunnel",
        CONNECT_LIMIT,
        "connection",
        () => openTunnel(option, { port, tunnelToken: secrets.tunnelToken, warn }),
        (late) => void late.close(),
      )
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
