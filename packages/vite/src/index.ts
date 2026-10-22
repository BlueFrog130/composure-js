import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { checkPlacement } from "composurejs/placement"
import { normalizePath, type Plugin } from "vite"
import { type DevOptions, setupDevLoop } from "./dev.ts"
import { describeBreaks, diffLock, type HandlerLock, inCi, LOCK_FILE, lockOf, readLock, writeLock } from "./lock.ts"
import { HandlerTransformError, parseModule, relativePath, type ShippedHandler, transformHandlers } from "./transform.ts"

export interface ComposureOptions {
  /** The module exporting the App as `app` or default. Default: `src/app.tsx`, `src/app.ts`, ... */
  app?: string
  /** Modules to transform. Default: JS/TS/JSX/TSX outside node_modules. */
  include?: RegExp
  /**
   * Warn, in `vite dev` and `vite build`, about a built-in tag written directly inside a parent
   * Discord does not allow it in (`<Button>` inside `<Container>`; ADR 0023). Render throws on
   * these either way. Default true.
   */
  placement?: boolean
  /** The Dev Loop in `vite dev` (ADR 0017): the tunnel and dev Sync. See {@link DevOptions}. */
  dev?: DevOptions
  /**
   * The Handler Lock (ADR 0029), `composure.handlers.json` at the root: `vite build` records every
   * handler id and warns about ids it drops; with `CI` set it fails instead and writes nothing;
   * `vite dev` warns. Default true.
   */
  handlerLock?: boolean
}

/** What `server()` reads from `composure()`. */
export interface ComposureApi {
  /** The App module, absolute, once the config is resolved. */
  appFile(): string
}

/** Line from 1, column from 0. */
function lineColumn(code: string, pos: number): { line: number; column: number } {
  const before = code.slice(0, pos)
  const lineStart = before.lastIndexOf("\n") + 1
  return { line: before.split("\n").length, column: pos - lineStart }
}

const APP_FILES = ["src/app.tsx", "src/app.ts", "src/index.tsx", "src/index.ts"]

/**
 * The composurejs Vite plugin, required to build a bot. Hoists Inline Handlers (`onClick={(c) => ..}`)
 * to module scope with stable ids, so each `custom_id` carries only what the handler captures
 * (ADR 0015), and runs the Dev Loop in `vite dev`. What the build produces is up to the other
 * plugins: `server()` for Node and Bun, `cloudflare()` from `@cloudflare/vite-plugin` for Workers.
 */
export default function composure(options: ComposureOptions = {}): Plugin<ComposureApi> {
  const include = options.include ?? /\.[cm]?[jt]sx?$/
  const { placement = true, handlerLock = true } = options
  let root: string | undefined
  let appFile = ""
  let command: "build" | "serve" = "serve"
  let lockFile = ""
  // Per environment, the handlers each module ships (a module transformed again replaces its own).
  const shipped = new Map<string, Map<string, ShippedHandler[]>>()
  let devLock: HandlerLock | undefined
  const devWarned = new Set<string>()
  return {
    name: "composurejs",
    // Before Oxc compiles TS and JSX, so hoisted handlers are copied as written.
    enforce: "pre",
    api: { appFile: () => appFile },

    configResolved(config) {
      root = config.root
      command = config.command
      lockFile = resolve(root, LOCK_FILE)
      appFile = normalizePath(resolve(root, options.app ?? APP_FILES.find((f) => existsSync(resolve(root!, f))) ?? APP_FILES[0]!))
    },

    configureServer(server) {
      // Under Vitest only with an injected transport: a test run must never reach Discord with the
      // developer's real token, whichever Vite config it loaded.
      if (process.env.VITEST && !options.dev?.transport) return
      setupDevLoop(server, options.dev ?? {}, appFile, () => composure({ include, placement: false, handlerLock: false }))
    },

    transform(code, id) {
      const file = id.split("?")[0]!
      if (!include.test(file) || /[\\/]node_modules[\\/]/.test(file)) return undefined
      let parsed: ReturnType<typeof parseModule> | null = null
      const parse = () => (parsed === null ? (parsed = parseModule(code, file)) : parsed)
      if (placement && code.includes("composurejs") && /<[A-Za-z]/.test(code)) {
        const program = parse()
        // `vite build` prints only the message, so it carries the position (`vite dev` adds a frame).
        for (const { message, node } of program ? checkPlacement(program) : []) {
          const { line, column } = lineColumn(code, node.start)
          this.warn({ message: `${relativePath(file, root)}:${line}:${column + 1}: ${message}`, pos: node.start })
        }
      }
      let result: ReturnType<typeof transformHandlers>
      try {
        result = transformHandlers(code, file, root === undefined ? {} : { root }, parse)
      } catch (error) {
        if (error instanceof HandlerTransformError) this.error({ message: error.message, pos: error.pos })
        throw error
      }
      if (handlerLock) {
        const handlers = result?.handlers ?? []
        if (command === "build") {
          const env = this.environment?.name ?? "build"
          if (!shipped.has(env)) shipped.set(env, new Map())
          shipped.get(env)!.set(file, handlers)
        } else if (!process.env.VITEST) {
          // vite dev: warn when an edit drops a locked handler of this module.
          devLock ??= readLock(lockFile) ?? {}
          const prefix = `${relativePath(file, root)}: `
          const ids = new Set(handlers.map((h) => h.id))
          const gone = Object.entries(devLock).filter(([id, h]) => h.where.startsWith(prefix) && !ids.has(id))
          const key = gone.map(([id]) => id).join()
          if (gone.length > 0 && !devWarned.has(key)) {
            devWarned.add(key)
            this.warn(
              `${relativePath(file, root)}: ${gone.length} handler${gone.length === 1 ? "" : "s"} in ${LOCK_FILE} no longer here (${gone.map(([id, h]) => `${id} in ${h.where.slice(prefix.length)}`).join(", ")}); buttons already sent with ${gone.length === 1 ? "it" : "them"} will answer "This message is outdated.". Use named() for messages meant to last.`,
            )
          }
        }
      }
      return result
    },

    buildEnd(error) {
      if (!handlerLock || command !== "build" || error) return
      const modules = shipped.get(this.environment?.name ?? "build")
      const current = lockOf([...(modules?.values() ?? [])].flat())
      // An environment without the App (no handlers at all) says nothing about the lock.
      if (Object.keys(current).length === 0) return
      const locked = readLock(lockFile)
      const ci = inCi()
      if (!locked) {
        if (ci) this.warn(`No ${LOCK_FILE}: run vite build locally and commit it, so CI can catch handler ids a deploy would drop (ADR 0029).`)
        else if (writeLock(lockFile, current)) this.info(`wrote ${LOCK_FILE} (${Object.keys(current).length} handlers): commit it`)
        return
      }
      const diff = diffLock(locked, current)
      const breaks = describeBreaks(diff, locked, current)
      if (ci) {
        if (breaks) {
          this.error(
            `Buttons already sent would answer "This message is outdated.": these handlers changed since ${LOCK_FILE}:\n${breaks}\nIf that is intended, run vite build locally and commit the updated ${LOCK_FILE}; to keep them working, give them fixed ids with named().`,
          )
        }
        if (diff.added.length > 0) this.warn(`${LOCK_FILE} is missing ${diff.added.length} new handler${diff.added.length === 1 ? "" : "s"}: run vite build locally and commit it.`)
        return
      }
      if (breaks) {
        this.warn(
          `Buttons already sent with these handlers will answer "This message is outdated." (${LOCK_FILE} updated; review it before committing):\n${breaks}\nTo keep them working, give them fixed ids with named().`,
        )
      }
      writeLock(lockFile, current)
    },
  }
}

export { composure, HandlerTransformError, transformHandlers }
export { server, SERVER_ENTRY, type ServerOptions } from "./server-plugin.ts"
export type { DevOptions, Tunnel } from "./dev.ts"
export { LOCK_FILE, type HandlerLock, type LockedHandler } from "./lock.ts"
