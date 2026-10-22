import type { Plugin, UserConfig } from "vite"
import { type DevOptions, setupDevLoop } from "./dev.ts"
import { HandlerTransformError, transformHandlers } from "./transform.ts"

export type Target = "cloudflare" | "node" | "bun"

export interface ComposureOptions {
  /**
   * What `vite build` produces. `node` and `bun` build `entry` into one self-contained ES module
   * (`dist/index.js`: dependencies bundled, built-ins external). `cloudflare` leaves the build to
   * `@cloudflare/vite-plugin`, which must be in `plugins` too, minified unless `build.minify` says
   * otherwise. Unset: only hoist.
   */
  target?: Target
  /** The server entry for `node` / `bun`. Default `src/node.ts` / `src/bun.ts`. */
  entry?: string
  /** Default `dist`. */
  outDir?: string
  /** Modules to transform. Default: JS/TS/JSX/TSX outside node_modules. */
  include?: RegExp
  /**
   * The Dev Loop in `vite dev` (ADR 0017), when a `target` is set: serving the App (node, bun),
   * the tunnel, and dev Sync. See {@link DevOptions}.
   */
  dev?: DevOptions
}

const DEFAULT_ENTRY: Record<Exclude<Target, "cloudflare">, string> = { node: "src/node.ts", bun: "src/bun.ts" }

/**
 * The composurejs Vite plugin, required to build a bot. Hoists Inline Handlers (`onClick={(c) => ..}`)
 * to module scope with stable ids, so each `custom_id` carries only what the handler captures
 * (ADR 0015), and sets up `vite build` for a target (ADR 0014).
 */
export default function composure(options: ComposureOptions = {}): Plugin {
  const include = options.include ?? /\.[cm]?[jt]sx?$/
  const { target } = options
  let root: string | undefined
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
          ssr: options.entry ?? DEFAULT_ENTRY[target],
          outDir: options.outDir ?? "dist",
          emptyOutDir: true,
          target: target === "node" ? "node20" : "esnext",
          rolldownOptions: { output: { entryFileNames: "index.js", format: "es" }, external: target === "bun" ? [/^bun(:|$)/] : [] },
        },
        // One file to deploy: bundle every dependency; Node built-ins stay external.
        ssr: { noExternal: true, target: "node" },
      }
    },

    configResolved(config) {
      root = config.root
      if (target !== "cloudflare" || config.command !== "build") return
      if (!config.plugins.some((p) => p.name.startsWith("vite-plugin-cloudflare"))) {
        throw new Error(
          'composure({ target: "cloudflare" }) builds through @cloudflare/vite-plugin: add it, plugins: [composure({ target: "cloudflare" }), cloudflare()]',
        )
      }
    },

    configureServer(server) {
      // Only with a target: Vitest serves the plugin too, and must never reach Discord.
      if (!target) return
      setupDevLoop(server, options.dev ?? {}, target === "node" || target === "bun", () => composure({ include }))
    },

    transform(code, id) {
      const file = id.split("?")[0]!
      if (!include.test(file) || /[\\/]node_modules[\\/]/.test(file)) return undefined
      try {
        return transformHandlers(code, file, root === undefined ? {} : { root })
      } catch (error) {
        if (error instanceof HandlerTransformError) this.error({ message: error.message, pos: error.pos })
        throw error
      }
    },
  }
}

export { composure, HandlerTransformError, transformHandlers }
export type { DevOptions, Tunnel } from "./dev.ts"
