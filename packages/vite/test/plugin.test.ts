import { describe, expect, test } from "vitest"
import { resolve } from "node:path"
import { type ConfigEnv, normalizePath, type Plugin, type ResolvedConfig, type UserConfig } from "vite"
import composure, { SERVER_ENTRY, server } from "../src/index.ts"

const build: ConfigEnv = { command: "build", mode: "production" }
const serve: ConfigEnv = { command: "serve", mode: "development" }
const config = (plugin: Plugin, user: UserConfig, env: ConfigEnv) => (plugin.config as (c: UserConfig, e: ConfigEnv) => UserConfig | undefined)(user, env)
const resolveWith = (plugin: Plugin, plugins: Plugin[]) =>
  (plugin.configResolved as (c: ResolvedConfig) => void)({ root: normalizePath(resolve("/proj")), command: "build", plugins } as unknown as ResolvedConfig)

describe("server()", () => {
  test("builds the Default Server, or your own entry, into a self-contained SSR bundle for Node and Bun", () => {
    expect(config(server(), {}, build)).toMatchObject({
      build: { ssr: true, outDir: "dist", target: "node22", rolldownOptions: { input: SERVER_ENTRY, output: { entryFileNames: "index.js" }, external: [/^bun(:|$)/] } },
      ssr: { noExternal: true, target: "node" },
    })
    const own = config(server({ entry: "server.ts", outDir: "out" }), {}, build)
    expect(own).toMatchObject({ build: { ssr: "server.ts", outDir: "out" } })
    expect(own?.build?.rolldownOptions).not.toHaveProperty("input")
  })

  test("the Default Server's entry serves composure()'s App module", () => {
    const host = composure({ app: "src/bot.ts" })
    const plugin = server()
    resolveWith(host, [host, plugin])
    resolveWith(plugin, [host, plugin])
    const id = (plugin.resolveId as (id: string) => string | undefined)(SERVER_ENTRY)
    expect(id).toBe(`\0${SERVER_ENTRY}`)
    const code = (plugin.load as (id: string) => string)(id!)
    expect(code).toMatch(/^import \* as module from ".*\/proj\/src\/bot\.ts"$/m)
    expect(code).toContain(`import { appOf, serve } from "@composurejs/vite/server"`)
    expect(code).toContain(`await serve(appOf(module, "src/bot.ts"))`)
    expect((plugin.resolveId as (id: string) => string | undefined)("./other.ts")).toBeUndefined()
  })

  test("needs composure() for the App module", () => {
    expect(() => resolveWith(server(), [server()])).toThrow("plugins: [composure(), server()]")
  })

  test("dev serves the App itself; composure() alone leaves the build and dev server to other plugins", () => {
    expect(config(server(), {}, serve)).toEqual({ appType: "custom" })
    expect(composure().config).toBeUndefined()
  })
})
