// The real `vite build` output, run the way it is deployed and driven with signed requests: the
// Worker from vite.config.ts on workerd, and the Default Server (`server()`) on Node and Bun.
// Proves Inline Handlers are hoisted in the bundle, not just under Vitest.
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { createServer, request as httpRequest } from "node:http"
import type { AddressInfo } from "node:net"
import { fileURLToPath } from "node:url"
import composure, { server as serverPlugin } from "@composurejs/vite"
import { convertV4MiniflareOptions, Miniflare } from "miniflare"
import { build } from "vite"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { chatInput, TestKey, TestResponse, type Buildable } from "composurejs/testing"

const root = fileURLToPath(new URL("..", import.meta.url))
const key = await TestKey.generate()

function viteBuild(...args: string[]) {
  execFileSync("pnpm", ["exec", "vite", "build", "--logLevel", "error", ...args], { cwd: root, stdio: "pipe", shell: process.platform === "win32" })
}

// The Node/Bun config a bot would have, `plugins: [composure(), server()]`; built once for both.
let serverBuilt: Promise<unknown> | undefined
const buildServer = () => (serverBuilt ??= build({ root, configFile: false, logLevel: "error", plugins: [composure(), serverPlugin({ outDir: "dist/server" })] }))

/** /counter, then press +5 on the message it answered with, against `send`. */
async function clickThrough(send: (body: string) => Promise<{ status: number; json: unknown }>) {
  const ask = async (interaction: Buildable) => {
    const payload = interaction.build()
    const res = await send(JSON.stringify(payload))
    expect(res.status).toBe(200)
    return TestResponse.of(res.status, res.json as never, [], payload)
  }
  const first = await ask(chatInput("counter"))
  expect(first.text).toBe("## Count: 0")
  // A generated handler id, then owner (a snowflake, base 36), count and step.
  expect(first.allComponents.find((c) => c.label === "+5")?.custom_id).toMatch(/^_[\w-]{7}:i[0-9a-z]+:n0:n5$/)
  const second = await ask(first.click("+5"))
  expect([second.type, second.text]).toEqual([7, "## Count: 5"])
  const stranger = await ask(first.click("+10").by({ id: "2" }))
  expect([stranger.text, stranger.isEphemeral]).toEqual(["Not your counter", true])
}

/** A port nothing listens on. */
async function freePort(): Promise<number> {
  const server = createServer().listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  await new Promise((resolve) => server.close(resolve))
  return port
}

/** Starts `cmd` with PORT set and waits until it answers HTTP. */
async function startServer(cmd: string, args: string[]): Promise<{ child: ChildProcess; port: number }> {
  const port = await freePort()
  const child = spawn(cmd, args, { cwd: root, env: { ...process.env, PORT: String(port), DISCORD_PUBLIC_KEY: key.publicKey }, stdio: ["ignore", "pipe", "pipe"] })
  let output = ""
  child.stdout!.on("data", (c: Buffer) => (output += c.toString()))
  child.stderr!.on("data", (c: Buffer) => (output += c.toString()))
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null)
      throw new Error(`${cmd} exited with ${child.exitCode}:
${output}`)
    const up = await new Promise<boolean>((resolve) => {
      const req = httpRequest({ host: "127.0.0.1", port, path: "/", method: "GET" }, (res) => (res.resume(), resolve(true)))
      req.on("error", () => resolve(false))
      req.end()
    })
    if (up) return { child, port }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  child.kill()
  throw new Error(`${cmd} did not start:
${output}`)
}

const overHttp = (port: number) => async (body: string) => {
  const headers = { "content-type": "application/json", ...(await key.sign(body)) }
  return new Promise<{ status: number; json: unknown }>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path: "/interactions", method: "POST", headers }, (res) => {
      let text = ""
      res.on("data", (c: Buffer) => (text += c.toString()))
      res.on("end", () => resolve({ status: res.statusCode!, json: text ? JSON.parse(text) : undefined }))
    })
    req.on("error", reject)
    req.end(body)
  })
}

describe("vite build", { timeout: 60_000 }, () => {
  describe("node", () => {
    let server: { child: ChildProcess; port: number }
    beforeAll(async () => {
      await buildServer()
      server = await startServer(process.execPath, ["dist/server/index.js"])
    }, 60_000)
    afterAll(() => void server?.child.kill())

    test("a self-contained bundle that answers and re-renders", async () => {
      await clickThrough(overHttp(server.port))
    })
  })

  const hasBun = spawnSync("bun", ["--version"], { shell: process.platform === "win32" }).status === 0
  describe.skipIf(!hasBun)("bun", () => {
    let server: { child: ChildProcess; port: number }
    beforeAll(async () => {
      await buildServer()
      server = await startServer("bun", ["dist/server/index.js"])
    }, 60_000)
    afterAll(() => void server?.child.kill())

    test("a self-contained bundle that answers and re-renders", async () => {
      await clickThrough(overHttp(server.port))
    })
  })

  describe("cloudflare", () => {
    let mf: Miniflare
    beforeAll(async () => {
      viteBuild()
      // Miniflare 5 (the version wrangler 4.151 ships) takes v4-style options through this converter.
      mf = new Miniflare(
        convertV4MiniflareOptions({
          modules: true,
          scriptPath: `${root}dist/composurejs_example_bot/index.js`,
          compatibilityDate: "2026-10-01",
          bindings: { DISCORD_PUBLIC_KEY: key.publicKey },
        }),
      )
      await mf.ready
    }, 60_000)
    afterAll(() => mf?.dispose())

    test("the Worker @cloudflare/vite-plugin builds answers and re-renders on workerd", async () => {
      await clickThrough(async (body) => {
        const res = await mf.dispatchFetch("https://bot.test/interactions", { method: "POST", headers: { "content-type": "application/json", ...(await key.sign(body)) }, body })
        return { status: res.status, json: await res.json() }
      })
    })
  })
})
