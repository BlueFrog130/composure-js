// `server()`: builds the Default Server, or your own entry, for Node and Bun (ADR 0024, 0025), and
// serves the App in `vite dev`. The App module is `composure()`'s.
import type { Plugin, UserConfig } from "vite"
import { serveInDev } from "./dev.ts"
import type { ComposureApi } from "./index.ts"
import { relativePath } from "./transform.ts"

export interface ServerOptions {
  /**
   * Your own server entry, built instead of the Default Server (`serve(app)` from
   * `@composurejs/vite/server`, logging where it listens). It can import `serve`, `toRequest` and
   * `send` from there, or call `app.fetch(request, env, platform)` from anything else.
   */
  entry?: string
  /** Default `dist`. */
  outDir?: string
}

/** The Default Server's entry module, generated around the App module. */
export const SERVER_ENTRY = "virtual:composure/server"
const RESOLVED_SERVER_ENTRY = `\0${SERVER_ENTRY}`

/**
 * `vite build` → one self-contained ES module, `dist/index.js` (dependencies bundled, built-ins
 * external), that runs on Node and Bun: `plugins: [composure(), server()]`.
 */
export function server(options: ServerOptions = {}): Plugin {
  let appFile: () => string
  let root = ""
  return {
    name: "composurejs:server",

    config(_, env): UserConfig {
      // The App answers requests itself: no SPA fallback or index.html.
      if (env.command === "serve") return { appType: "custom" }
      return {
        build: {
          // A string is a path from the root; the virtual entry goes in as rolldown input.
          ssr: options.entry ?? true,
          outDir: options.outDir ?? "dist",
          emptyOutDir: true,
          target: "node20",
          rolldownOptions: {
            ...(options.entry === undefined && { input: SERVER_ENTRY }),
            output: { entryFileNames: "index.js", format: "es" },
            // Bun's built-ins, for an entry of your own that imports them.
            external: [/^bun(:|$)/],
          },
        },
        // One file to deploy: bundle every dependency; Node built-ins stay external.
        ssr: { noExternal: true, target: "node" },
      }
    },

    configResolved(config) {
      root = config.root
      const api = config.plugins.find((p) => p.name === "composurejs")?.api as ComposureApi | undefined
      if (!api) throw new Error("server() serves the App composure() finds: plugins: [composure(), server()]")
      appFile = api.appFile
    },

    configureServer(devServer) {
      serveInDev(devServer, appFile())
    },

    resolveId(id) {
      return id === SERVER_ENTRY ? RESOLVED_SERVER_ENTRY : undefined
    },

    load(id) {
      if (id !== RESOLVED_SERVER_ENTRY) return undefined
      return [
        `import * as module from ${JSON.stringify(appFile())}`,
        `import { appOf, serve } from "@composurejs/vite/server"`,
        `const server = await serve(appOf(module, ${JSON.stringify(relativePath(appFile(), root))}))`,
        `console.info({ msg: "Listening", url: server.url })`,
        "",
      ].join("\n")
    },
  }
}
