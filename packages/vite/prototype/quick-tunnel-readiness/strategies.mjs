// PROTOTYPE, throwaway: times a cloudflared quick tunnel from spawn to Discord accepting it as the
// interactions endpoint. Usage: node strategies.mjs <env file> [runs per strategy]
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { createInterface } from "node:readline"

const env = Object.fromEntries(
  readFileSync(process.argv[2], "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
)
const RUNS = Number(process.argv[3] ?? 2)
const TOKEN = env.DISCORD_TOKEN
const KEY = await crypto.subtle.importKey("raw", Buffer.from(env.DISCORD_PUBLIC_KEY, "hex"), "Ed25519", false, ["verify"])
const API = "https://discord.com/api/v10/applications/@me"
const auth = { authorization: `Bot ${TOKEN}`, "content-type": "application/json" }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const me = await (await fetch(API, { headers: auth })).json()
if (me.id !== env.COMPOSURE_DEV_APPLICATION_ID) throw new Error("token is not the dev application's; refusing")
const original = me.interactions_endpoint_url ?? null
console.log(JSON.stringify({ app: me.id, original }))

let pings = 0
const server = createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", async () => {
    const sig = req.headers["x-signature-ed25519"]
    const ts = req.headers["x-signature-timestamp"]
    const ok = sig && ts && (await crypto.subtle.verify("Ed25519", KEY, Buffer.from(sig, "hex"), Buffer.from(ts + body)))
    if (!ok) return res.writeHead(401).end("bad signature")
    pings++
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ type: 1 }))
  })
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const port = server.address().port

async function doh(host) {
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${host}&type=A`, { headers: { accept: "application/dns-json" } })
    const j = await r.json()
    return j.Status === 0 && (j.Answer ?? []).length > 0
  } catch {
    return false
  }
}

async function probe(url) {
  try {
    const r = await fetch(`${url}/interactions`, { method: "POST", body: "{}", signal: AbortSignal.timeout(5000) })
    return r.status
  } catch (e) {
    return e.cause?.code ?? e.message
  }
}

/** strategy: when to start PATCHing. "url" = at once, "registered" = first registered connection, "doh" = registered + DoH answers + probe 401. */
async function run(strategy) {
  const t0 = Date.now()
  const t = () => Date.now() - t0
  const marks = { strategy }
  const child = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] })
  let url
  let registered = false
  const lines = (s) =>
    createInterface({ input: s }).on("line", (line) => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(line)
      if (m && !url) ((url = m[0]), (marks.urlPrinted = t()))
      if (!registered && line.includes("Registered tunnel connection")) ((registered = true), (marks.registered = t()))
    })
  lines(child.stdout)
  lines(child.stderr)
  try {
    while (!url) await sleep(100)
    if (strategy !== "url") while (!registered) await sleep(100)
    const host = new URL(url).hostname
    if (strategy === "doh") {
      while (!(await doh(host))) await sleep(500)
      marks.dohResolved = t()
      let s
      while ((s = await probe(url)) !== 401) {
        marks.lastProbe = s
        await sleep(1000)
      }
      marks.probe401 = t()
    }
    const before = pings
    marks.attempts = 0
    for (;;) {
      marks.attempts++
      const r = await fetch(API, { method: "PATCH", headers: auth, body: JSON.stringify({ interactions_endpoint_url: `${url}/interactions` }) })
      if (r.ok) break
      marks.lastStatus = r.status
      if (t() > 180_000) {
        marks.gaveUp = true
        break
      }
      await sleep(3000)
    }
    marks.accepted = marks.gaveUp ? null : t()
    marks.pingsSeen = pings - before
    // In parallel, never part of the readiness path: when DoH first answered for strategies that didn't wait.
    if (strategy !== "doh") marks.dohNow = await doh(host)
  } finally {
    child.kill()
    await sleep(1500)
  }
  console.log(JSON.stringify(marks))
}

try {
  for (let i = 0; i < RUNS; i++) for (const s of ["url", "registered", "doh"]) await run(s)
} finally {
  await fetch(API, { method: "PATCH", headers: auth, body: JSON.stringify({ interactions_endpoint_url: original }) })
  console.log(JSON.stringify({ restored: original }))
  server.close()
}
