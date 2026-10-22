import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { checkPlacement } from "composurejs/placement"
import { normalizePath, type Plugin } from "vite"
import { type DevOptions, setupDevLoop } from "./dev.ts"
import { HandlerTransformError, parseModule, relativePath, transformHandlers } from "./transform.ts"

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
  const { placement = true } = options
  let root: string | undefined
  let appFile = ""
  return {
    name: "composurejs",
    // Before Oxc compiles TS and JSX, so hoisted handlers are copied as written.
    enforce: "pre",
    api: { appFile: () => appFile },

    configResolved(config) {
      root = config.root
      appFile = normalizePath(resolve(root, options.app ?? APP_FILES.find((f) => existsSync(resolve(root!, f))) ?? APP_FILES[0]!))
    },

    configureServer(server) {
      // Under Vitest only with an injected transport: a test run must never reach Discord with the
      // developer's real token, whichever Vite config it loaded.
      if (process.env.VITEST && !options.dev?.transport) return
      setupDevLoop(server, options.dev ?? {}, appFile, () => composure({ include, placement: false }))
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
      try {
        return transformHandlers(code, file, root === undefined ? {} : { root }, parse)
      } catch (error) {
        if (error instanceof HandlerTransformError) this.error({ message: error.message, pos: error.pos })
        throw error
      }
    },
  }
}

export { composure, HandlerTransformError, transformHandlers }
export { server, SERVER_ENTRY, type ServerOptions } from "./server-plugin.ts"
export type { DevOptions, Tunnel } from "./dev.ts"
