// The Dev Loop against a real `vite dev` server and a throwaway bot project. Discord is a recording
// Transport and the tunnel a stand-in: nothing leaves the machine.
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { request as httpRequest } from "node:http"
import type { AddressInfo } from "node:net"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, test } from "vitest"
import { createLogger, createServer, type ViteDevServer } from "vite"
import { command as invoke, TestKey, TestResponse } from "composurejs/testing"
import composure, { type DevOptions, server as serverPlugin } from "../src/index.ts"

const APP_ID = "1052322265397739523"
const GUILD = "798662131062931547"
const key = await TestKey.generate()

const appSource = (reply: string, extra = "") => `
import { App, Button, command, Row } from "composurejs"
export const app = new App()
  .command(command({ name: "hello", description: "Hi", handler: () => <Row><Button onClick={(c) => c.reply("${reply}")}>Go</Button></Row> }))
  ${extra}
`

let dir: string
let server: ViteDevServer | undefined

function project(env: Record<string, string>, source = appSource("v1")): string {
  dir = fileURLToPath(new URL(`./.tmp/${Math.random().toString(36).slice(2)}/`, import.meta.url))
  mkdirSync(`${dir}src`, { recursive: true })
  writeFileSync(`${dir}package.json`, JSON.stringify({ type: "module" }))
  writeFileSync(`${dir}tsconfig.json`, JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "composurejs" } }))
  writeFileSync(
    `${dir}.env`,
    Object.entries({ DISCORD_PUBLIC_KEY: key.publicKey, ...env })
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  )
  writeFileSync(`${dir}src/app.tsx`, source)
  return dir
}

/** Records Discord calls and answers each like Discord would, by route. */
function discord() {
  const calls: { method: string; path: string; body: unknown }[] = []
  const transport = async (request: Request) => {
    const path = new URL(request.url).pathname.replace("/api/v10", "")
    calls.push({ method: request.method, path, body: request.method === "GET" ? undefined : await request.json() })
    return Response.json(request.method === "PATCH" ? {} : [])
  }
  return { calls, transport }
}

async function start(dev: DevOptions, logs: string[] = []) {
  const logger = createLogger("info")
  logger.info = (msg) => void logs.push(msg)
  logger.warn = (msg) => void logs.push(msg)
  server = await createServer({
    root: dir,
    configFile: false,
    customLogger: logger,
    plugins: [composure({ dev }), serverPlugin()],
    server: { port: 0, host: "127.0.0.1", hmr: false },
  })
  await server.listen()
  return (server.httpServer!.address() as AddressInfo).port
}

function post(port: number, body: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path: "/interactions", method: "POST", headers: { "content-type": "application/json", ...headers } }, (res) => {
      let text = ""
      res.on("data", (c: Buffer) => (text += c.toString()))
      res.on("end", () => resolve({ status: res.statusCode!, text }))
    })
    req.on("error", reject)
    req.end(body)
  })
}

async function ask(port: number, interaction: { build(): unknown }) {
  const payload = interaction.build()
  const body = JSON.stringify(payload)
  const res = await post(port, body, await key.sign(body))
  return TestResponse.of(res.status, JSON.parse(res.text), [], payload as never)
}

const until = async (check: () => boolean, ms = 5000) => {
  for (const start = Date.now(); !check();) {
    if (Date.now() - start > ms) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 25))
  }
}

afterEach(async () => {
  await server?.close()
  server = undefined
  rmSync(dir, { recursive: true, force: true })
})

describe("vite dev", { timeout: 30_000 }, () => {
  test("under Vitest without an injected transport, the Dev Loop stays off", async () => {
    project({ DISCORD_TOKEN: "t", COMPOSURE_DEV_GUILD: GUILD })
    const logs: string[] = []
    const port = await start({}, logs)
    // server() still serves the App locally; nothing reaches Discord.
    expect((await post(port, "{}")).status).toBe(401)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(logs.join("\n")).not.toMatch(/dev Sync|tunnel/)
  })

  test("serves the App with its handlers compiled, and picks up edits without a restart", async () => {
    project({})
    const port = await start({ tunnel: false, sync: false, transport: discord().transport })
    const first = await ask(port, invoke("hello"))
    expect((await ask(port, first.click("Go"))).text).toBe("v1")
    expect((await post(port, "{}")).status).toBe(401)

    writeFileSync(`${dir}src/app.tsx`, appSource("v2"))
    // The watcher invalidates the module shortly after the write.
    let text: string | undefined
    for (let i = 0; i < 80 && text !== "v2"; i++) {
      const again = await ask(port, invoke("hello"))
      text = (await ask(port, again.click("Go"))).text
      if (text !== "v2") await new Promise((r) => setTimeout(r, 100))
    }
    expect(text).toBe("v2")
  })

  test("tunnel: points the dev application's endpoint at it; dev Sync: Commands to the dev guild, again on change", async () => {
    const { calls, transport } = discord()
    project({ DISCORD_TOKEN: "t", DISCORD_APPLICATION_ID: APP_ID, COMPOSURE_DEV_APPLICATION_ID: APP_ID, COMPOSURE_DEV_GUILD: GUILD })
    let closed = false
    const logs: string[] = []
    await start({ transport, startTunnel: async () => ({ url: "https://dev-bot.trycloudflare.com", close: async () => void (closed = true) }) }, logs)

    await until(() => calls.some((c) => c.method === "PATCH") && calls.some((c) => c.method === "PUT"))
    expect(calls.find((c) => c.method === "PATCH")).toEqual({
      method: "PATCH",
      path: "/applications/@me",
      body: { interactions_endpoint_url: "https://dev-bot.trycloudflare.com/interactions" },
    })
    expect(calls.find((c) => c.method === "PUT")).toEqual({
      method: "PUT",
      path: `/applications/${APP_ID}/guilds/${GUILD}/commands`,
      body: [{ type: 1, name: "hello", description: "Hi" }],
    })
    expect(logs.join("\n")).toContain(`dev Sync to guild ${GUILD}: 1 to create, 0 to update, 0 to delete`)

    writeFileSync(`${dir}src/app.tsx`, appSource("v1", `.command(command({ name: "bye", description: "Bye", handler: () => "bye" }))`))
    await until(() => calls.filter((c) => c.method === "PUT").length === 2, 8000)
    expect((calls.filter((c) => c.method === "PUT")[1]!.body as { name: string }[]).map((c) => c.name)).toEqual(["hello", "bye"])

    await server!.close()
    server = undefined
    expect(closed).toBe(true)
  })

  test("never repoints an application not named as the dev application", async () => {
    const { calls, transport } = discord()
    project({ DISCORD_TOKEN: "t", DISCORD_APPLICATION_ID: APP_ID, COMPOSURE_DEV_APPLICATION_ID: "1111111111111111111" })
    const logs: string[] = []
    await start({ transport, startTunnel: async () => ({ url: "https://x.trycloudflare.com", close: async () => {} }) }, logs)
    await until(() => logs.some((l) => l.includes("not changing its endpoint")))
    expect(calls.filter((c) => c.method === "PATCH")).toEqual([])
    expect(logs.join("\n")).toContain("Set the Interactions Endpoint URL by hand: https://x.trycloudflare.com/interactions")
  })
})
