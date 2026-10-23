// A named Cloudflare Tunnel (`dev.tunnel: { name, hostname }`, ADR 0031): `cloudflared tunnel run`
// with the tunnel's token, from `CLOUDFLARE_TUNNEL_TOKEN` or else `cloudflared tunnel token <name>`
// (after `cloudflared tunnel login`).
import { type ChildProcess, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { Tunnel } from "./tunnel.ts"

/** Starts cloudflared with these arguments and extra environment (tests swap in a stand-in). */
export type SpawnCloudflared = (args: string[], env: Record<string, string>) => ChildProcess

const spawnCloudflared: SpawnCloudflared = (args, env) =>
  spawn(process.env.CLOUDFLARED_PATH || "cloudflared", args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } })

export interface NamedTunnelOptions {
  /** The tunnel's name, to fetch its token with. */
  name: string
  /** The public hostname the tunnel routes to this server. */
  hostname: string
  /** The local port `vite dev` listens on. */
  port: number
  /** The tunnel's token (`CLOUDFLARE_TUNNEL_TOKEN`; Cloudflare dashboard → the tunnel → install command); skips the fetch. */
  token?: string | undefined
  warn(message: string): void
  spawn?: SpawnCloudflared | undefined
  /** How long to wait for cloudflared's first connection, in ms. */
  timeout?: number
}

/** Resolves once cloudflared has registered a connection; warns when the tunnel routes `hostname` elsewhere. */
export async function startNamedTunnel(options: NamedTunnelOptions): Promise<Tunnel> {
  const { name: label, port, warn, timeout = 30_000 } = options
  const url = `https://${options.hostname}`
  const run = options.spawn ?? spawnCloudflared
  const token = options.token ?? (await tunnelToken(run, label))
  // The token goes through the environment: an argument would show in the process list.
  const child = run(["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`, "run"], { TUNNEL_TOKEN: token })
  const kill = () => void child.kill()
  process.once("exit", kill)
  let closing = false
  const close = () =>
    new Promise<void>((resolve) => {
      closing = true
      process.off("exit", kill)
      if (child.exitCode !== null || child.signalCode !== null) return resolve()
      child.once("exit", () => resolve())
      child.kill()
    })

  return new Promise((resolve, reject) => {
    let ready = false
    let last = ""
    const fail = (error: Error) => {
      clearTimeout(timer)
      void close()
      reject(error)
    }
    const timer = setTimeout(() => fail(new Error(`cloudflared did not connect tunnel ${label} within ${timeout / 1000}s: ${last}`)), timeout)
    const onLine = (line: string) => {
      if (line.trim()) last = line.trim()
      // A dashboard-managed tunnel's routes win over --url: check they reach this server.
      const config = /Updated to new configuration config="((?:[^"\\]|\\.)*)"/.exec(line)
      if (config) {
        try {
          const { ingress } = JSON.parse(JSON.parse(`"${config[1]}"`) as string) as { ingress?: IngressRule[] }
          const problem = routeProblem(ingress ?? [], url, port)
          if (problem) warn(`tunnel ${label} ${problem}: change the route in the Cloudflare dashboard (Networks → Tunnels), or vite's server.port.`)
        } catch {
          // An unexpected log format: nothing to check.
        }
      }
      if (!ready && line.includes("Registered tunnel connection")) {
        ready = true
        clearTimeout(timer)
        resolve({ url, close })
      }
    }
    createInterface({ input: child.stdout! }).on("line", onLine)
    createInterface({ input: child.stderr! }).on("line", onLine)
    child.once("error", (error) => fail(notInstalled(error)))
    child.once("exit", (code) => {
      if (!ready) fail(new Error(`cloudflared exited (${code}) before connecting tunnel ${label}: ${last}`))
      else if (!closing) warn(`cloudflared exited (${code}); tunnel ${label} is down: ${last}`)
    })
  })
}

export interface IngressRule {
  hostname?: string
  service: string
}

/** What is wrong with how the tunnel's routes reach `url`'s host, if anything. */
export function routeProblem(ingress: IngressRule[], url: string, port: number): string | undefined {
  if (ingress.length === 0) return undefined
  const host = new URL(url).hostname
  const rule = ingress.find((r) => r.hostname === host || (r.hostname?.startsWith("*.") && host.endsWith(r.hostname.slice(1))))
  if (!rule) return `has no route for ${host} (${ingress.map((r) => r.hostname ?? "*").join(", ")})`
  let target: URL
  try {
    target = new URL(rule.service)
  } catch {
    return `routes ${host} to ${rule.service}, not to this server`
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  const targetPort = Number(target.port || (target.protocol === "https:" ? 443 : 80))
  return local && targetPort === port ? undefined : `routes ${host} to ${rule.service}, but vite dev listens on http://localhost:${port}`
}

function tunnelToken(run: SpawnCloudflared, name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = run(["tunnel", "token", name], {})
    let out = ""
    let err = ""
    child.stdout!.on("data", (chunk: Buffer) => (out += chunk.toString()))
    child.stderr!.on("data", (chunk: Buffer) => (err += chunk.toString()))
    child.once("error", (error) => reject(notInstalled(error)))
    child.once("close", (code) => {
      if (code === 0 && out.trim()) return resolve(out.trim())
      const reason = err.trim().split("\n").at(-1) ?? `exit ${code}`
      reject(new Error(`cloudflared tunnel token ${name} failed (${reason}): run \`cloudflared tunnel login\`, or set CLOUDFLARE_TUNNEL_TOKEN`))
    })
  })
}

function notInstalled(error: Error): Error {
  return (error as { code?: string }).code === "ENOENT" ? new Error("cloudflared is not installed: install it, or set CLOUDFLARED_PATH") : error
}
