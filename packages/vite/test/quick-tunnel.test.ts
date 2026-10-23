// The quick tunnel against a stand-in cloudflared (a Node script) and a scripted DNS: nothing leaves
// the machine. Ready only at the first registered connection, then an A record from the zone's
// authoritative nameservers; nothing looks the hostname up recursively before that (ADR 0031).
import { type ChildProcess, spawn } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";
import type { SpawnCloudflared } from "../src/cloudflared.ts";
import { type QuickTunnelDns, startQuickTunnel } from "../src/quick-tunnel.ts";
import { StageError } from "../src/stage.ts";

const HOST = "plain-river-dawn-arch.trycloudflare.com";
const NS = { "trycloudflare.com": ["ns-a.cloudflare.example", "ns-b.cloudflare.example"] };
const NS_IPS: Record<string, string[]> = { "ns-a.cloudflare.example": ["198.51.100.1"], "ns-b.cloudflare.example": ["198.51.100.2"] };

/**
 * cloudflared that prints the quick tunnel's URL, then registers a connection when told to on
 * stdin (`register`), and otherwise prints what it is given.
 */
function fake(spawned: { args: string[]; child: ChildProcess }[]): SpawnCloudflared {
  const script = `
    console.error("INF Requesting new quick Tunnel on trycloudflare.com...")
    console.error("INF |  https://${HOST}  |")
    require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
      if (line === "register") console.error("INF Registered tunnel connection connIndex=0 location=ams01 protocol=quic")
      else if (line === "exit") process.exit(3)
      else console.error(line)
    })
  `;
  return (args, env) => {
    const child = spawn(process.execPath, ["-e", script, "--", ...args], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
    spawned.push({ args, child });
    return child;
  };
}

/** DNS whose authoritative answer for HOST is `published` (else NXDOMAIN); records every question. */
function scriptedDns(): QuickTunnelDns & { published?: string; recursive: string[]; authoritative: { servers: string[]; host: string }[] } {
  const recursive: string[] = [];
  const authoritative: { servers: string[]; host: string }[] = [];
  const dns: ReturnType<typeof scriptedDns> = {
    recursive,
    authoritative,
    resolveNs: async (zone: string) => {
      recursive.push(zone);
      const names = NS[zone as keyof typeof NS];
      if (!names) throw Object.assign(new Error(`queryNs ENOTFOUND ${zone}`), { code: "ENOTFOUND" });
      return names;
    },
    resolve4: async (host: string) => {
      recursive.push(host);
      const ips = NS_IPS[host];
      if (!ips) throw Object.assign(new Error(`queryA ENOTFOUND ${host}`), { code: "ENOTFOUND" });
      return ips;
    },
    resolve4At: async (servers: string[], host: string) => {
      authoritative.push({ servers, host });
      if (host !== HOST || !dns.published) throw Object.assign(new Error(`queryA ENOTFOUND ${host}`), { code: "ENOTFOUND" });
      return [dns.published];
    },
  };
  return dns;
}

const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const tell = (child: ChildProcess, line: string) => child.stdin!.write(`${line}\n`);
const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

let children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children) child.kill();
  children = [];
});

describe("quick tunnel", { timeout: 15_000 }, () => {
  test("ready only after the registered connection and the authoritative A record; resolves with that address", async () => {
    const spawned: { args: string[]; child: ChildProcess }[] = [];
    const dns = scriptedDns();
    let ready = false;
    const opening = startQuickTunnel({ port: 5173, spawn: fake(spawned), dns, warn: () => {}, interval: 20 });
    void opening.then(() => (ready = true));
    await tick();
    children = spawned.map((s) => s.child);
    expect(spawned.map((s) => s.args)).toEqual([["tunnel", "--no-autoupdate", "--url", "http://localhost:5173"]]);
    // The URL is printed, but no connection is registered: no DNS question yet.
    expect(ready).toBe(false);
    expect(dns.authoritative).toEqual([]);

    tell(spawned[0]!.child, "register");
    await tick();
    // Connected, but the zone's nameservers do not answer for the host yet.
    expect(ready).toBe(false);
    expect(dns.authoritative.length).toBeGreaterThan(0);
    expect(dns.authoritative[0]).toEqual({ servers: ["198.51.100.1", "198.51.100.2"], host: HOST });

    dns.published = "203.0.113.7";
    const tunnel = await opening;
    expect(tunnel.url).toBe(`https://${HOST}`);
    expect(tunnel.address).toBe("203.0.113.7");
    // Only the zone and its nameservers went through a recursive resolver, never the hostname.
    expect(dns.recursive).not.toContain(HOST);
    expect(dns.recursive[0]).toBe("trycloudflare.com");

    await tunnel.close();
    expect(exited(spawned[0]!.child)).toBe(true);
  });

  test("no registered connection within the connect limit fails the tunnel stage with cloudflared's last line, and stops it", async () => {
    const spawned: { args: string[]; child: ChildProcess }[] = [];
    const dns = scriptedDns();
    const opening = startQuickTunnel({ port: 5173, spawn: fake(spawned), dns, warn: () => {}, connectLimit: 600 });
    await tick();
    children = spawned.map((s) => s.child);
    tell(spawned[0]!.child, 'ERR Failed to dial a quic connection error="timeout: no recent network activity"');
    const failure = await opening.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StageError);
    expect((failure as StageError).stage).toBe("tunnel");
    expect((failure as StageError).message).toBe(
      'no registered connection from cloudflared within 0.6s (last: ERR Failed to dial a quic connection error="timeout: no recent network activity")',
    );
    expect(dns.authoritative).toEqual([]);
    await tick();
    expect(exited(spawned[0]!.child)).toBe(true);
  });

  test("no authoritative A record within the DNS limit fails the dns stage with the last outcome, and stops cloudflared", async () => {
    const spawned: { args: string[]; child: ChildProcess }[] = [];
    const dns = scriptedDns();
    const opening = startQuickTunnel({ port: 5173, spawn: fake(spawned), dns, warn: () => {}, dnsLimit: 400, interval: 20 });
    await tick();
    children = spawned.map((s) => s.child);
    tell(spawned[0]!.child, "register");
    const failure = await opening.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StageError);
    expect((failure as StageError).stage).toBe("dns");
    expect((failure as StageError).message).toBe(`no A record for ${HOST} from trycloudflare.com's nameservers within 0.4s (last: ENOTFOUND)`);
    expect(dns.recursive).not.toContain(HOST);
    await tick();
    expect(exited(spawned[0]!.child)).toBe(true);
  });

  test("cloudflared exiting before it connects fails the tunnel stage with its last line", async () => {
    const spawned: { args: string[]; child: ChildProcess }[] = [];
    const opening = startQuickTunnel({ port: 5173, spawn: fake(spawned), dns: scriptedDns(), warn: () => {} });
    await tick();
    children = spawned.map((s) => s.child);
    tell(spawned[0]!.child, "ERR failed to request quick Tunnel: 429 Too Many Requests");
    await tick(50);
    tell(spawned[0]!.child, "exit");
    const failure = await opening.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StageError);
    expect((failure as StageError).stage).toBe("tunnel");
    expect((failure as StageError).message).toBe("cloudflared exited (3) before connecting: ERR failed to request quick Tunnel: 429 Too Many Requests");
  });

  test("cloudflared not installed says so", async () => {
    const missing: SpawnCloudflared = () => spawn("composure-no-such-cloudflared", [], { stdio: ["ignore", "pipe", "pipe"] });
    await expect(startQuickTunnel({ port: 5173, spawn: missing, dns: scriptedDns(), warn: () => {} })).rejects.toThrow("cloudflared is not installed");
  });

  test("cloudflared exiting once connected warns that the tunnel is down", async () => {
    const spawned: { args: string[]; child: ChildProcess }[] = [];
    const dns = scriptedDns();
    dns.published = "203.0.113.7";
    const warnings: string[] = [];
    const opening = startQuickTunnel({ port: 5173, spawn: fake(spawned), dns, warn: (m) => warnings.push(m) });
    await tick();
    children = spawned.map((s) => s.child);
    tell(spawned[0]!.child, "register");
    await opening;
    tell(spawned[0]!.child, "exit");
    for (let i = 0; i < 40 && warnings.length === 0; i++) await tick(25);
    expect(warnings).toEqual(["cloudflared exited (3); the quick tunnel is down"]);
  });
});
