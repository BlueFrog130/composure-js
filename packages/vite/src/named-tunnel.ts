// A named Cloudflare Tunnel (`dev.tunnel: { name, hostname }`, ADR 0031): `cloudflared tunnel run`
// with the tunnel's token, from `CLOUDFLARE_TUNNEL_TOKEN` or else `cloudflared tunnel token <name>`
// (after `cloudflared tunnel login`).
import { createInterface } from "node:readline";
import type { SpawnCloudflared } from "./cloudflared.ts";
import type { DevLog } from "./dev-log.ts";
import type { Tunnel } from "./tunnel.ts";

export interface NamedTunnelOptions extends Pick<DevLog, "warn"> {
  /** The tunnel's name, to fetch its token with. */
  name: string;
  /** The public hostname the tunnel routes to this server. */
  hostname: string;
  /** The local port `vite dev` listens on. */
  port: number;
  /** The tunnel's token (`CLOUDFLARE_TUNNEL_TOKEN`; Cloudflare dashboard → the tunnel → install command); skips the fetch. */
  token?: string | undefined;
  /** Starts the resolved cloudflared (tests swap in a stand-in). */
  spawn: SpawnCloudflared;
  /** Gets each line cloudflared logs while connecting. */
  observe?: ((line: string) => void) | undefined;
  /** Aborted when the connect limit passes: cloudflared is stopped. */
  signal?: AbortSignal | undefined;
}

/** Resolves once cloudflared has registered a connection; warns when the tunnel routes `hostname` elsewhere. */
export async function startNamedTunnel(options: NamedTunnelOptions): Promise<Tunnel> {
  const { name, port, warn, spawn, signal } = options;
  const url = `https://${options.hostname}`;
  const token = options.token ?? (await tunnelToken(spawn, name));
  signal?.throwIfAborted();
  // The token goes through the environment: an argument would show in the process list.
  const child = spawn(["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`, "run"], { TUNNEL_TOKEN: token });
  const kill = () => void child.kill();
  process.once("exit", kill);
  let closing = false;
  const close = () =>
    new Promise<void>((resolve) => {
      closing = true;
      process.off("exit", kill);
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", () => resolve());
      child.kill();
    });

  return new Promise((resolve, reject) => {
    let ready = false;
    let last = "";
    const stop = () => fail(signal!.reason as Error);
    const fail = (error: Error) => {
      signal?.removeEventListener("abort", stop);
      void close();
      reject(error);
    };
    signal?.addEventListener("abort", stop, { once: true });
    const onLine = (line: string) => {
      if (line.trim()) options.observe?.((last = line.trim()));
      // A dashboard-managed tunnel's routes win over --url: check they reach this server.
      const config = /Updated to new configuration config="((?:[^"\\]|\\.)*)"/.exec(line);
      if (config) {
        try {
          const { ingress } = JSON.parse(JSON.parse(`"${config[1]}"`) as string) as { ingress?: IngressRule[] };
          const problem = routeProblem(ingress ?? [], url, port);
          if (problem) warn(`tunnel ${name} ${problem}: change the route in the Cloudflare dashboard (Networks → Tunnels), or vite's server.port.`);
        } catch {
          // An unexpected log format: nothing to check.
        }
      }
      if (!ready && line.includes("Registered tunnel connection")) {
        ready = true;
        signal?.removeEventListener("abort", stop);
        resolve({ url, close });
      }
    };
    createInterface({ input: child.stdout! }).on("line", onLine);
    createInterface({ input: child.stderr! }).on("line", onLine);
    child.once("error", (error) => fail(notInstalled(error)));
    child.once("exit", (code) => {
      if (!ready) fail(new Error(`cloudflared exited (${code}) before connecting tunnel ${name}: ${last}`));
      else if (!closing) warn(`cloudflared exited (${code}); tunnel ${name} is down: ${last}`);
    });
  });
}

export interface IngressRule {
  hostname?: string;
  service: string;
}

/** What is wrong with how the tunnel's routes reach `url`'s host, if anything. */
export function routeProblem(ingress: IngressRule[], url: string, port: number): string | undefined {
  if (ingress.length === 0) return undefined;
  const host = new URL(url).hostname;
  const rule = ingress.find((r) => r.hostname === host || (r.hostname?.startsWith("*.") && host.endsWith(r.hostname.slice(1))));
  if (!rule) return `has no route for ${host} (${ingress.map((r) => r.hostname ?? "*").join(", ")})`;
  let target: URL;
  try {
    target = new URL(rule.service);
  } catch {
    return `routes ${host} to ${rule.service}, not to this server`;
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  const targetPort = Number(target.port || (target.protocol === "https:" ? 443 : 80));
  return local && targetPort === port ? undefined : `routes ${host} to ${rule.service}, but vite dev listens on http://localhost:${port}`;
}

function tunnelToken(run: SpawnCloudflared, name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = run(["tunnel", "token", name], {});
    let out = "";
    let err = "";
    child.stdout!.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr!.on("data", (chunk: Buffer) => (err += chunk.toString()));
    child.once("error", (error) => reject(notInstalled(error)));
    child.once("close", (code) => {
      if (code === 0 && out.trim()) return resolve(out.trim());
      const reason = err.trim().split("\n").at(-1) ?? `exit ${code}`;
      reject(new Error(`cloudflared tunnel token ${name} failed (${reason}): run \`cloudflared tunnel login\`, or set CLOUDFLARE_TUNNEL_TOKEN`));
    });
  });
}

function notInstalled(error: Error): Error {
  return (error as { code?: string }).code === "ENOENT" ? new Error("cloudflared is not installed: install it, or set CLOUDFLARED_PATH") : error;
}
