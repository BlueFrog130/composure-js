import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { checkPlacement } from "composurejs/placement"
import { normalizePath, type Plugin, type UserConfig } from "vite"
import { type DevOptions, setupDevLoop } from "./dev.ts"
import { HandlerTransformError, parseModule, relativePath, transformHandlers } from "./transform.ts"

export type Target = "cloudflare" | "node" | "bun"

export interface ComposureOptions {
  /**
   * What `vite build` produces. `node` and `bun` build the server into one self-contained ES module
   * (`dist/index.js`: dependencies bundled, built-ins external). `cloudflare` leaves the build to
   * `@cloudflare/vite-plugin`, which must be in `plugins` too, minified unless `build.minify` says
   * otherwise. Unset: only hoist.
   */
  target?: Target
  /** The module exporting the App as `app` or default. Default: `src/app.tsx`, `src/app.ts`, ... */
  app?: string
  /**
   * Your own server entry for `node` / `bun`, built instead of the Default Server (`serve(app)` from
   * `@composurejs/vite/server`, logging where it listens). It can import `serve`, `toRequest` and
   * `send` from there, or call `app.fetch(request, env, platform)` from anything else.
   */
  entry?: string
  /** Default `dist`. */
  outDir?: string
  /** Modules to transform. Default: JS/TS/JSX/TSX outside node_modules. */
  include?: RegExp
  /**
   * Warn, in `vite dev` and `vite build`, about a built-in tag written directly inside a parent
   * Discord does not allow it in (`<Button>` inside `<Container>`; ADR 0023). Render throws on
   * these either way. Default true.
   */
  placement?: boolean
  /**
   * The Dev Loop in `vite dev` (ADR 0017), when a `target` is set: serving the App (node, bun),
   * the tunnel, and dev Sync. See {@link DevOptions}.
   */
  dev?: DevOptions
}

/** Line from 1, column from 0. */
function lineColumn(code: string, pos: number): { line: number; column: number } {
  const before = code.slice(0, pos)
  const lineStart = before.lastIndexOf("\n") + 1
  return { line: before.split("\n").length, column: pos - lineStart }
}

const APP_FILES = ["src/app.tsx", "src/app.ts", "src/index.tsx", "src/index.ts"]

/** The Default Server's entry module, generated around the App module. */
export const SERVER_ENTRY = "virtual:composure/server"
const RESOLVED_SERVER_ENTRY = `\0${SERVER_ENTRY}`

/**
 * The composurejs Vite plugin, required to build a bot. Hoists Inline Handlers (`onClick={(c) => ..}`)
 * to module scope with stable ids, so each `custom_id` carries only what the handler captures
 * (ADR 0015), and sets up `vite build` for a target (ADR 0014).
 */
export default function composure(options: ComposureOptions = {}): Plugin {
  const include = options.include ?? /\.[cm]?[jt]sx?$/
  const { target, placement = true } = options
  let root: string | undefined
  let appFile = ""
  return {
    name: "composurejs",
    // Before Oxc compiles TS and JSX, so hoisted handlers are copied as written.
    enforce: "pre",

    config(config, env): UserConfig | undefined {
      // The App answers requests itself: no SPA fallback or index.html.
      if (env.command === "serve") return target === "node" || target === "bun" ? { appType: "custom" } : undefined
      if (env.command !== "build") return undefined
      // Bundle size is cold-start time on Workers; servers keep readable stack traces.
      if (target === "cloudflare") return config.build?.minify === undefined ? { build: { minify: true } } : undefined
      if (target !== "node" && target !== "bun") return undefined
      return {
        build: {
          // A string is a path from the root; the virtual entry goes in as rolldown input.
          ssr: options.entry ?? true,
          outDir: options.outDir ?? "dist",
          emptyOutDir: true,
          target: target === "node" ? "node20" : "esnext",
          rolldownOptions: {
            ...(options.entry === undefined && { input: SERVER_ENTRY }),
            output: { entryFileNames: "index.js", format: "es" },
            external: target === "bun" ? [/^bun(:|$)/] : [],
          },
        },
        // One file to deploy: bundle every dependency; Node built-ins stay external.
        ssr: { noExternal: true, target: "node" },
      }
    },

    configResolved(config) {
      root = config.root
      appFile = normalizePath(resolve(root, options.app ?? APP_FILES.find((f) => existsSync(resolve(root!, f))) ?? APP_FILES[0]!))
      if (target !== "cloudflare" || config.command !== "build") return
      if (!config.plugins.some((p) => p.name.startsWith("vite-plugin-cloudflare"))) {
        throw new Error('composure({ target: "cloudflare" }) builds through @cloudflare/vite-plugin: add it, plugins: [composure({ target: "cloudflare" }), cloudflare()]')
      }
    },

    configureServer(server) {
      // Only with a target; and under Vitest only with an injected transport: a test run must never
      // reach Discord with the developer's real token, whichever Vite config it loaded.
      if (!target || (process.env.VITEST && !options.dev?.transport)) return
      setupDevLoop(server, options.dev ?? {}, appFile, target === "node" || target === "bun", () => composure({ include, placement: false }))
    },

    resolveId(id) {
      return id === SERVER_ENTRY ? RESOLVED_SERVER_ENTRY : undefined
    },

    load(id) {
      if (id !== RESOLVED_SERVER_ENTRY) return undefined
      return [
        `import * as module from ${JSON.stringify(appFile)}`,
        `import { appOf, serve } from "@composurejs/vite/server"`,
        `const server = await serve(appOf(module, ${JSON.stringify(relativePath(appFile, root))}))`,
        `console.info({ msg: "Listening", url: server.url })`,
        "",
      ].join("\n")
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
export type { DevOptions, Tunnel } from "./dev.ts"
