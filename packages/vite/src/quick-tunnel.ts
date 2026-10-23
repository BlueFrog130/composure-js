// The quick tunnel (`dev.tunnel: "quick"`, the default): a cloudflared quick tunnel on
// trycloudflare.com (ADR 0031). Its hostname is published 1–3 s after cloudflared registers a
// connection, and any recursive lookup before that caches NXDOMAIN for 60 s, at Discord too. So it
// is ready only once the zone's authoritative nameservers answer with an A record, and it returns
// that IP as `address` for Repoint's probe: nothing looks the hostname up recursively before then.
import type { ChildProcess } from "node:child_process";
import { Resolver, resolve4, resolveNs } from "node:dns/promises";
import { createInterface } from "node:readline";
import type { SpawnCloudflared } from "./cloudflared.ts";
import type { DevLog } from "./dev-log.ts";
import { CONNECT_LIMIT, sleep, StageError, withinLimit } from "./stage.ts";
import type { Tunnel } from "./tunnel.ts";

/** The DNS the quick tunnel asks (tests script it). */
export interface QuickTunnelDns {
  /** Recursive: a zone's nameservers' names. */
  resolveNs(zone: string): Promise<string[]>;
  /** Recursive: a nameserver's addresses. Never asked for the tunnel's hostname. */
  resolve4(host: string): Promise<string[]>;
  /** `host`'s A records, asked of these nameservers directly. */
  resolve4At(servers: string[], host: string): Promise<string[]>;
}

const systemDns: QuickTunnelDns = {
  resolveNs,
  resolve4,
  resolve4At: (servers, host) => {
    const resolver = new Resolver({ timeout: 2000, tries: 1 });
    resolver.setServers(servers);
    return resolver.resolve4(host);
  },
};

/** The authoritative nameservers must publish the hostname within this. */
const DNS_LIMIT = 60_000;
/** How often they are asked. */
const DNS_INTERVAL = 1000;

export interface QuickTunnelOptions extends Pick<DevLog, "warn"> {
  /** The local port `vite dev` listens on. */
  port: number;
  /** Starts cloudflared with the resolved binary (tests swap in a stand-in). */
  spawn: SpawnCloudflared;
  dns?: QuickTunnelDns | undefined;
  /** Tests: the stages' limits and how often DNS is asked, in ms. */
  connectLimit?: number;
  dnsLimit?: number;
  interval?: number;
}

/**
 * Resolves once the tunnel is connected and its hostname published, with `address`. Fails with a
 * {@link StageError}: `tunnel` (no registered connection), `dns` (no authoritative A record).
 */
export async function startQuickTunnel(options: QuickTunnelOptions): Promise<Tunnel> {
  const { port, warn, dns = systemDns, interval = DNS_INTERVAL } = options;
  const child = options.spawn(["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], {});
  const kill = () => void child.kill();
  process.once("exit", kill);
  let closing = false;
  let connected = false;
  const close = () =>
    new Promise<void>((resolve) => {
      closing = true;
      process.off("exit", kill);
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", () => resolve());
      child.kill();
    });
  child.once("exit", (code) => {
    if (connected && !closing) warn(`cloudflared exited (${code}); the quick tunnel is down`);
  });

  try {
    const url = await withinLimit("tunnel", options.connectLimit ?? CONNECT_LIMIT, "registered connection from cloudflared", (observe) => registered(child, observe));
    connected = true;
    const host = new URL(url).hostname;
    const zone = host.slice(host.indexOf(".") + 1);
    const address = await withinLimit("dns", options.dnsLimit ?? DNS_LIMIT, `A record for ${host} from ${zone}'s nameservers`, async (observe, signal) => {
      let servers: string[] | undefined;
      while (!signal.aborted) {
        try {
          servers ??= await nameservers(dns, zone);
          const [ip] = await dns.resolve4At(servers, host);
          if (ip) return ip;
          observe("no A record");
        } catch (error) {
          observe(describeDnsError(error));
        }
        await sleep(interval);
      }
      throw signal.reason;
    });
    return { url, address, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** The addresses of `zone`'s nameservers: an NS lookup, then each name's addresses. */
async function nameservers(dns: QuickTunnelDns, zone: string): Promise<string[]> {
  const names = await dns.resolveNs(zone);
  const addresses = (await Promise.all(names.map((name) => dns.resolve4(name).catch(() => [])))).flat();
  if (addresses.length === 0) throw new Error(`no address for ${zone}'s nameservers (${names.join(", ")})`);
  return addresses;
}

/** Resolves with the tunnel's URL at cloudflared's first registered connection. */
function registered(child: ChildProcess, observe: (line: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    let url: string | undefined;
    let last = "";
    let done = false;
    const onLine = (line: string) => {
      if (done) return;
      if (line.trim()) observe((last = line.trim()));
      url ??= /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(line)?.[0];
      if (url && line.includes("Registered tunnel connection")) {
        done = true;
        resolve(url);
      }
    };
    createInterface({ input: child.stdout! }).on("line", onLine);
    createInterface({ input: child.stderr! }).on("line", onLine);
    child.once("error", (error: NodeJS.ErrnoException) => {
      done = true;
      reject(error.code === "ENOENT" ? new StageError("tunnel", "cloudflared is not installed: install it, or set CLOUDFLARED_PATH") : error);
    });
    child.once("exit", (code) => {
      if (done) return;
      done = true;
      reject(new StageError("tunnel", `cloudflared exited (${code}) before connecting${last ? `: ${last}` : ""}`));
    });
  });
}

function describeDnsError(error: unknown): string {
  const { code, message } = error as NodeJS.ErrnoException;
  return code ?? message;
}
