// Cold start of the built example Worker on workerd (Miniflare), against a trivial JS Worker, so
// the difference is what composurejs costs: startup, the first request (a signed PING), the
// first Command, and warm requests. Run after `pnpm build`:  node scripts/coldstart.mjs [runs]
// Report only: timings vary too much between machines to gate CI on (size-limit gates size).
import { mkdirSync, writeFileSync } from "node:fs"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import { chatInput, TestKey } from "composurejs/testing"
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare } from "miniflare"

const runs = Number(process.argv[2] ?? 5)
const WARM = 50
const bot = fileURLToPath(new URL("../dist/composurejs_example_bot/index.js", import.meta.url))
// Under the project: workerd fails to load modules from the OS temp directory on Windows.
const baselineDir = fileURLToPath(new URL("../.tmp/coldstart/", import.meta.url))
mkdirSync(baselineDir, { recursive: true })
const baseline = `${baselineDir}worker.js`
// Reads the body as the bot does: an unread request body stalls the connection and skews timings.
writeFileSync(baseline, `export default { fetch: async (request) => (await request.text(), Response.json({ type: 1 })) }`)
const key = await TestKey.generate()

async function measure(scriptPath) {
  const t0 = performance.now()
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath,
      compatibilityDate: "2026-10-01",
      bindings: { DISCORD_PUBLIC_KEY: key.publicKey },
      // The Worker's console output would interleave with the report (and cost time to print): drain it.
      handleRuntimeStdio: (stdout, stderr) => (stdout.resume(), stderr.resume()),
      handleStructuredLogs: () => {},
      log: new Log(LogLevel.NONE),
    }),
  )
  await mf.ready
  const startup = performance.now() - t0
  const send = async (payload) => {
    const body = JSON.stringify(payload)
    const t = performance.now()
    const res = await mf.dispatchFetch("https://bot.test/interactions", { method: "POST", headers: { "content-type": "application/json", ...(await key.sign(body)) }, body })
    await res.text()
    if (res.status !== 200) throw new Error(`${scriptPath}: ${res.status}`)
    return performance.now() - t
  }
  const first = await send({ id: "1", application_id: "1", type: 1, token: "t", version: 1 })
  const firstCommand = await send(chatInput("ping").build())
  const warm = []
  for (let i = 0; i < WARM; i++) warm.push(await send(chatInput("ping").build()))
  await mf.dispose()
  return { startup, first, firstCommand, warm: median(warm) }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const medianOf = (results, k) => median(results.map((r) => r[k]))

// One discarded run warms the process (workerd binary, Miniflare's own setup); then alternate
// which Worker goes first, so neither pays for running first.
await measure(baseline)
const results = { bot: [], baseline: [] }
for (let i = 0; i < runs; i++) {
  const order = i % 2 === 0 ? ["baseline", "bot"] : ["bot", "baseline"]
  for (const which of order) results[which].push(await measure(which === "bot" ? bot : baseline))
}

const rows = ["startup", "first", "firstCommand", "warm"].map((k) => {
  const b = medianOf(results.bot, k)
  const base = medianOf(results.baseline, k)
  return {
    metric: { startup: "startup (workerd + module)", first: "first request (PING)", firstCommand: "first Command", warm: `warm Command (median of ${WARM})` }[k],
    "example bot (ms)": b.toFixed(2),
    "JS baseline (ms)": base.toFixed(2),
    "composurejs (ms)": (b - base).toFixed(2),
  }
})
console.log(`Cold start on workerd, median of ${runs} runs:`)
console.table(rows)
