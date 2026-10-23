// The quick tunnel (`dev.tunnel: "quick"`, the default): a cloudflared quick tunnel on
// trycloudflare.com, through `untun` until it waits for authoritative DNS (ADR 0031).
import type { Tunnel } from "./tunnel.ts"

export async function startQuickTunnel(port: number): Promise<Tunnel> {
  const { startTunnel } = await import("untun")
  const tunnel = await startTunnel({ port, hostname: "localhost", acceptCloudflareNotice: true })
  if (!tunnel) throw new Error("cloudflared did not start")
  return { url: await tunnel.getURL(), close: () => tunnel.close() }
}
