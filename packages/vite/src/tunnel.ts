// The Dev Loop's Tunnel (ADR 0031): a public URL reaching `vite dev`, whichever kind `dev.tunnel` picks.
import { resolveCloudflared, type SpawnCloudflared, spawnCloudflared } from "./cloudflared.ts";
import { startNamedTunnel } from "./named-tunnel.ts";
import { startQuickTunnel } from "./quick-tunnel.ts";
import { StageError, withinLimit } from "./stage.ts";

/** A connected tunnel to `vite dev`. */
export interface Tunnel {
  /** Its public URL, e.g. `https://bot-dev.example.com`. */
  url: string;
  /**
   * An IP the URL's host is known to resolve to. Endpoint's probe connects there instead of looking
   * the host up, so no resolver caches a miss for a hostname that is not published yet.
   */
  address?: string | undefined;
  close(): Promise<void>;
}

/** A named Cloudflare Tunnel the plugin runs with cloudflared. */
export interface NamedTunnelOption {
  /** The tunnel's name: its token is `CLOUDFLARE_TUNNEL_TOKEN`, else `cloudflared tunnel token <name>` (after `cloudflared tunnel login`). */
  name: string;
  /** The public hostname its route sends to this server, e.g. `dev.example.com`. Vite allows this host. */
  hostname: string;
}

/** A tunnel you already run (ngrok, ...), forwarding to `vite dev`. */
export interface UrlTunnelOption {
  /** Its public URL. Vite allows its host. */
  url: string;
}

/**
 * Which tunnel `vite dev` opens:
 * - `"quick"` (default): a cloudflared quick tunnel on trycloudflare.com, no account needed;
 * - `{ name, hostname }`: your named Cloudflare Tunnel, run by the plugin;
 * - `{ url }`: a tunnel you already run;
 * - `(port) => Promise<Tunnel>`: anything else. Add its host to Vite's `server.allowedHosts`
 *   yourself, or Vite's host check blocks its requests;
 * - `false`: none; the endpoint is not repointed.
 */
export type TunnelOption = "quick" | NamedTunnelOption | UrlTunnelOption | ((port: number) => Promise<Tunnel>) | false;

/** The hosts Vite must allow for this tunnel; undefined leaves `server.allowedHosts` to the user. */
export function allowedHostsOf(option: TunnelOption): string[] | undefined {
  // Vite freezes allowedHosts before a quick tunnel's hostname is known: the whole zone, whose names
  // resolve to Cloudflare, never to this machine.
  if (option === "quick") return [".trycloudflare.com"];
  if (option === false || typeof option === "function") return undefined;
  return "url" in option ? [new URL(option.url).hostname] : [option.hostname];
}

export interface OpenTunnelOptions {
  /** The port `vite dev` listens on. */
  port: number;
  /** The project root: a downloaded cloudflared is cached under its `node_modules/.cache/composurejs/`. */
  root: string;
  /** `CLOUDFLARE_TUNNEL_TOKEN`, for a named tunnel. */
  tunnelToken?: string | undefined;
  info(message: string): void;
  warn(message: string): void;
  /** Starts cloudflared (tests swap in a stand-in); default the binary {@link resolveCloudflared} finds. */
  spawn?: SpawnCloudflared | undefined;
}

/** A named or custom tunnel must connect within this; the quick tunnel limits its own stages. */
const CONNECT_LIMIT = 30_000;

/**
 * Opens the tunnel and resolves once it is connected (a quick tunnel: and published). Fails with a
 * {@link StageError}: `cloudflared`, `tunnel` or `dns`.
 */
export async function openTunnel(option: Exclude<TunnelOption, false>, options: OpenTunnelOptions): Promise<Tunnel> {
  const { port, warn } = options;
  if (option === "quick") return startQuickTunnel({ port, warn, spawn: await cloudflared(options) });
  if (typeof option === "function") return connectWithinLimit(() => option(port));
  if ("url" in option) return { url: option.url, close: async () => {} };
  const spawn = await cloudflared(options);
  return connectWithinLimit(() => startNamedTunnel({ name: option.name, hostname: option.hostname, port, token: options.tunnelToken, warn, spawn }));
}

const connectWithinLimit = (open: () => Promise<Tunnel>) => withinLimit("tunnel", CONNECT_LIMIT, "connection", open, (late) => void late.close());

/** Starts cloudflared: the injected one, else the one found or downloaded (outside the connect limit). */
async function cloudflared(options: OpenTunnelOptions): Promise<SpawnCloudflared> {
  if (options.spawn) return options.spawn;
  try {
    return spawnCloudflared(await resolveCloudflared({ root: options.root, log: options.info }));
  } catch (error) {
    throw new StageError("cloudflared", (error as Error).message);
  }
}
