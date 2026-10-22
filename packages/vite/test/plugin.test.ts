import { describe, expect, test } from "vitest"
import type { ConfigEnv, Plugin, ResolvedConfig, UserConfig } from "vite"
import composure from "../src/index.ts"

const build: ConfigEnv = { command: "build", mode: "production" }
const serve: ConfigEnv = { command: "serve", mode: "development" }
const config = (plugin: Plugin, user: UserConfig, env: ConfigEnv) => (plugin.config as (c: UserConfig, e: ConfigEnv) => UserConfig | undefined)(user, env)

describe("build targets", () => {
  test("node and bun build a self-contained SSR entry", () => {
    expect(config(composure({ target: "node" }), {}, build)).toMatchObject({
      build: { ssr: "src/node.ts", outDir: "dist", target: "node20", rolldownOptions: { output: { entryFileNames: "index.js" } } },
      ssr: { noExternal: true, target: "node" },
    })
    expect(config(composure({ target: "bun", entry: "server.ts", outDir: "out" }), {}, build)).toMatchObject({
      build: { ssr: "server.ts", outDir: "out", rolldownOptions: { external: [/^bun(:|$)/] } },
    })
  })

  test("cloudflare minifies unless the config says otherwise, and needs @cloudflare/vite-plugin", () => {
    const plugin = composure({ target: "cloudflare" })
    expect(config(plugin, {}, build)).toEqual({ build: { minify: true } })
    expect(config(plugin, { build: { minify: false } }, build)).toBeUndefined()
    const resolved = (plugins: string[]) => ({ command: "build", plugins: plugins.map((name) => ({ name })) }) as unknown as ResolvedConfig
    const check = plugin.configResolved as (c: ResolvedConfig) => void
    expect(() => check(resolved(["composurejs"]))).toThrow("builds through @cloudflare/vite-plugin")
    expect(() => check(resolved(["composurejs", "vite-plugin-cloudflare"]))).not.toThrow()
  })

  test("dev serves the App itself for node and bun; nothing changes without a target", () => {
    expect(config(composure({ target: "node" }), {}, serve)).toEqual({ appType: "custom" })
    expect(config(composure({ target: "cloudflare" }), {}, serve)).toBeUndefined()
    expect(config(composure(), {}, build)).toBeUndefined()
  })
})
