import { describe, expect, test } from "vitest"
import { resolve } from "node:path"
import { type ConfigEnv, normalizePath, type Plugin, type ResolvedConfig, type UserConfig } from "vite"
import composure, { SERVER_ENTRY } from "../src/index.ts"

const build: ConfigEnv = { command: "build", mode: "production" }
const serve: ConfigEnv = { command: "serve", mode: "development" }
const config = (plugin: Plugin, user: UserConfig, env: ConfigEnv) => (plugin.config as (c: UserConfig, e: ConfigEnv) => UserConfig | undefined)(user, env)

describe("build targets", () => {
  test("node and bun build the Default Server, or your own entry, into a self-contained SSR bundle", () => {
    expect(config(composure({ target: "node" }), {}, build)).toMatchObject({
      build: { ssr: true, outDir: "dist", target: "node20", rolldownOptions: { input: SERVER_ENTRY, output: { entryFileNames: "index.js" } } },
      ssr: { noExternal: true, target: "node" },
    })
    expect(config(composure({ target: "bun", entry: "server.ts", outDir: "out" }), {}, build)).toMatchObject({
      build: { ssr: "server.ts", outDir: "out", rolldownOptions: { external: [/^bun(:|$)/] } },
    })
  })

  test("the Default Server's entry serves the App module", () => {
    const plugin = composure({ target: "node", app: "src/bot.ts" })
    ;(plugin.configResolved as (c: ResolvedConfig) => void)({ root: normalizePath(resolve("/proj")), command: "build", plugins: [] } as unknown as ResolvedConfig)
    const id = (plugin.resolveId as (id: string) => string | undefined)(SERVER_ENTRY)
    expect(id).toBe(`\0${SERVER_ENTRY}`)
    const code = (plugin.load as (id: string) => string)(id!)
    expect(code).toMatch(/^import \* as module from ".*\/proj\/src\/bot\.ts"$/m)
    expect(code).toContain(`import { appOf, serve } from "@composurejs/vite/server"`)
    expect(code).toContain(`await serve(appOf(module, "src/bot.ts"))`)
    expect((plugin.resolveId as (id: string) => string | undefined)("./other.ts")).toBeUndefined()
  })

  test("cloudflare minifies unless the config says otherwise, and needs @cloudflare/vite-plugin", () => {
    const plugin = composure({ target: "cloudflare" })
    expect(config(plugin, {}, build)).toEqual({ build: { minify: true } })
    expect(config(plugin, { build: { minify: false } }, build)).toBeUndefined()
    const resolved = (plugins: string[]) => ({ root: process.cwd(), command: "build", plugins: plugins.map((name) => ({ name })) }) as unknown as ResolvedConfig
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
