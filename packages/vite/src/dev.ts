// The Dev Loop (ADR 0017): `vite dev` serves the App (node/bun; Workers via @cloudflare/vite-plugin),
// opens a tunnel, points the *dev* application's interactions endpoint at it, and syncs Commands to a
// dev guild on start and whenever the code changes.
import { existsSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { resolve } from "node:path"
import { send, toRequest } from "@composurejs/adapter-node"
import { createTracker, type ScopedDefinition, type Transport } from "composurejs"
import { BotClient, editCurrentApplication } from "composurejs/rest"
import { apply, configFromEnv, plan, summary, type SyncConfig } from "composurejs/sync"
import { isRunnableDevEnvironment, loadEnv, type Plugin, runnerImport, type ViteDevServer } from "vite"

export interface Tunnel {
  url: string
  close(): Promise<void>
}

export interface DevOptions {
  /** The module exporting the App as `app` or default. Default: `src/app.tsx`, `src/app.ts`, ... */
  app?: string
  /**
   * Open a public tunnel to `vite dev` and point the dev application's interactions endpoint at
   * it. Default: when `COMPOSURE_DEV_APPLICATION_ID` is set. Uses a cloudflared quick tunnel
   * (downloaded on first use, under Cloudflare's terms) unless `startTunnel` says otherwise.
   */
  tunnel?: boolean
  /** Sync Commands to `COMPOSURE_DEV_GUILD` on start and on every change. Default: when it is set. */
  sync?: boolean
  /** Another tunnel (ngrok, a fixed hostname, ...): given the local port, resolves to its public URL. */
  startTunnel?: (port: number) => Promise<Tunnel>
  /** REST requests to Discord (tests). Default `fetch`. */
  transport?: Transport
}

export const DEV_APPLICATION_VAR = "COMPOSURE_DEV_APPLICATION_ID"
export const DEV_GUILD_VAR = "COMPOSURE_DEV_GUILD"

const ENTRIES = ["src/app.tsx", "src/app.ts", "src/index.tsx", "src/index.ts"]

/**
 * Sets the Dev Loop up on a dev server. `serveApp`: this plugin serves the App (node, bun), not
 * another one (Workers). `hoist` makes the plugin dev Sync loads the App with.
 */
export function setupDevLoop(server: ViteDevServer, options: DevOptions, serveApp: boolean, hoist: () => Plugin): void {
  const root = server.config.root
  const logger = server.config.logger
  const tag = "\x1b[36m[composure]\x1b[0m"
  const info = (msg: string) => logger.info(`${tag} ${msg}`, { timestamp: true })
  const warn = (msg: string) => logger.warn(`${tag} ${msg}`, { timestamp: true })
  const env: Record<string, string | undefined> = { ...loadEnv(server.config.mode, server.config.envDir === false ? root : (server.config.envDir ?? root), ""), ...process.env }
  const appFile = resolve(root, options.app ?? ENTRIES.find((e) => existsSync(resolve(root, e))) ?? ENTRIES[0]!)
  const rest = options.transport ? { transport: options.transport } : {}

  if (serveApp) {
    const platform = createTracker()
    server.middlewares.use((req, res, next) => {
      if (req.method !== "POST" && req.url !== "/health") return next()
      if (req.url === "/health") return void res.writeHead(200, { "content-type": "text/plain" }).end("ok")
      void (async () => {
        const ssr = server.environments.ssr
        if (!isRunnableDevEnvironment(ssr)) throw new Error("The ssr environment is not runnable in this process")
        const app = appOf(await ssr.runner.import(appFile), appFile)
        const request = await toRequest(req)
        await send(res, request ? await app.fetch(request, env, platform) : new Response("Payload Too Large", { status: 413 }))
      })().catch((error: unknown) => {
        server.ssrFixStacktrace(error as Error)
        logger.error(`${tag} ${(error as Error).stack ?? String(error)}`)
        if (!res.headersSent) res.writeHead(500).end("Internal Server Error")
      })
    })
  }

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
  const devGuild = env[DEV_GUILD_VAR] ?? env.DISCORD_GUILD_ID
  if (options.sync ?? devGuild !== undefined) {
    let last = ""
    let running: Promise<void> = Promise.resolve()
    const syncNow = () =>
      (running = running.then(async () => {
        const cfg = discord()
        if (!cfg) return
        if (!devGuild) return warn(`dev Sync needs ${DEV_GUILD_VAR}: the guild to sync Commands to while developing.`)
        try {
          const { module } = await runnerImport<Record<string, unknown>>(appFile, { root, plugins: [hoist()], logLevel: "error" })
          const definitions = appOf(module, appFile).definitions()
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
  const devApp = env[DEV_APPLICATION_VAR]
  if (options.tunnel ?? devApp !== undefined) {
    let tunnel: Tunnel | undefined
    server.httpServer?.once("listening", () => {
      void (async () => {
        const { port } = server.httpServer!.address() as AddressInfo
        tunnel = await (options.startTunnel ?? cloudflared)(port)
        const endpoint = `${tunnel.url.replace(/\/$/, "")}/interactions`
        info(`tunnel: ${tunnel.url}`)
        const cfg = discord()
        if (!cfg) return
        // Never repoint a production application: only the one named as the dev application.
        if (devApp !== cfg.applicationId) {
          warn(
            devApp
              ? `${DEV_APPLICATION_VAR} (${devApp}) is not the token's application (${cfg.applicationId}); not changing its endpoint. Set the Interactions Endpoint URL by hand: ${endpoint}`
              : `Set ${DEV_APPLICATION_VAR}=${cfg.applicationId} to point this (dev!) application at the tunnel, or set its Interactions Endpoint URL by hand: ${endpoint}`,
          )
          return
        }
        await editCurrentApplication(new BotClient(cfg.token, rest), { interactions_endpoint_url: endpoint })
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

function appOf(module: Record<string, unknown>, file: string): LoadedApp {
  const app = [module.app, module.default].find((v) => typeof (v as LoadedApp | undefined)?.fetch === "function" && typeof (v as LoadedApp).definitions === "function")
  if (!app) throw new Error(`${file} must export the App as \`app\` or as its default export`)
  return app as LoadedApp
}

async function cloudflared(port: number): Promise<Tunnel> {
  const { startTunnel } = await import("untun")
  const tunnel = await startTunnel({ port, hostname: "localhost", acceptCloudflareNotice: true })
  if (!tunnel) throw new Error("cloudflared did not start")
  return { url: await tunnel.getURL(), close: () => tunnel.close() }
}
