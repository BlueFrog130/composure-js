// The Worker as deployed: `vite build` (wrangler.jsonc's production env), run on workerd by
// Miniflare, answering signed Interactions and running its cron trigger. Nothing here reaches
// Discord, GitHub or npm.
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { convertV4MiniflareOptions, Miniflare } from "miniflare"
import { afterAll, beforeAll, expect, test } from "vitest"
import { type Buildable, chatInput, ping, TestKey, TestResponse } from "composurejs/testing"

const root = fileURLToPath(new URL("..", import.meta.url))
const key = await TestKey.generate()
let mf: Miniflare

beforeAll(async () => {
  execFileSync("pnpm", ["exec", "vite", "build", "--logLevel", "error"], { cwd: root, stdio: "pipe", shell: process.platform === "win32" })
  // Miniflare 5 (the version wrangler 4.151 ships) takes v4-style options through this converter.
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: `${root}dist/composurejs_bot/index.js`,
      compatibilityDate: "2026-10-01",
      kvNamespaces: ["KV"],
      bindings: {
        DISCORD_PUBLIC_KEY: key.publicKey,
        ANNOUNCE_CHANNEL_ID: "600000000000000001",
        FEEDBACK_CHANNEL_ID: "600000000000000002",
        LOG_CHANNEL_ID: "600000000000000003",
      },
    }),
  )
  await mf.ready
}, 120_000)
afterAll(() => mf?.dispose())

async function ask(interaction: Buildable) {
  const body = JSON.stringify(interaction.build())
  const res = await mf.dispatchFetch("https://bot.test/interactions", { method: "POST", headers: { "content-type": "application/json", ...(await key.sign(body)) }, body })
  expect(res.status).toBe(200)
  return TestResponse.of(res.status, (await res.json()) as never)
}

test("the built Worker answers Interactions", async () => {
  expect((await ask(ping())).type).toBe(1)
  const docs = await ask(chatInput("docs").option("topic", "code splitting"))
  expect(docs.text).toContain("### Handlers and Views › Code splitting")
  const about = await ask(chatInput("about"))
  // vite.config.ts's commit, not Vitest's "dev"
  expect(about.text).toMatch(/at \[`(?!dev`)\w+`\]/)
})

test("the built Worker runs its cron trigger", async () => {
  // Miniflare 5's types leave out the Fetcher's scheduled(), which workerd has
  const worker = (await mf.getWorker()) as unknown as { scheduled(options: { cron: string }): Promise<{ outcome: string }> }
  // No DISCORD_TOKEN here: the run is logged as failed, never thrown
  expect(await worker.scheduled({ cron: "*/15 * * * *" })).toMatchObject({ outcome: "ok" })
})
