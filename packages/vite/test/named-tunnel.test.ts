// The Dev Loop's named Cloudflare Tunnel against a stand-in cloudflared (a Node script): nothing
// leaves the machine.
import { spawn } from "node:child_process";
import { describe, expect, test } from "vitest";
import type { SpawnCloudflared } from "../src/cloudflared.ts";
import { routeProblem } from "../src/named-tunnel.ts";
import { type NamedTunnelOption, type OpenTunnelOptions, tunnelFor } from "../src/tunnel.ts";

const HOST = "bot-dev.example.com";
const URL_ = `https://${HOST}`;

const openTunnel = (option: NamedTunnelOption, options: OpenTunnelOptions) => tunnelFor(option)!.open(options);

/** cloudflared that prints `token` for `tunnel token`, else logs like `tunnel run` with these routes. */
function fake(routes: { hostname?: string; service: string }[], calls: { args: string[]; env: Record<string, string> }[] = []): SpawnCloudflared {
  const config = JSON.stringify({ ingress: routes }).replace(/"/g, '\\"');
  const script = `
    const args = process.argv.slice(1)
    if (args[1] === "token") { process.stdout.write(args[2] === "bot-dev" ? "secret-token\\n" : ""); process.stderr.write("ERR unknown tunnel\\n"); process.exit(args[2] === "bot-dev" ? 0 : 1) }
    if (process.env.TUNNEL_TOKEN !== "secret-token") { console.error("ERR bad token"); process.exit(1) }
    console.error("INF Registered tunnel connection connIndex=0")
    console.error(${JSON.stringify(`INF Updated to new configuration config="${config}" version=1`)})
    setInterval(() => {}, 1000)
  `;
  return (args, env) => {
    calls.push({ args, env });
    return spawn(process.execPath, ["-e", script, "--", ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
  };
}

describe("named tunnel", { timeout: 15_000 }, () => {
  test("fetches the token by name, runs the tunnel with it in the environment, and closes it", async () => {
    const calls: { args: string[]; env: Record<string, string> }[] = [];
    const warnings: string[] = [];
    const tunnel = await openTunnel(
      { name: "bot-dev", hostname: HOST },
      { port: 5173, root: ".", info: () => {}, warn: (m) => warnings.push(m), spawn: fake([{ hostname: HOST, service: "http://localhost:5173" }], calls) },
    );
    expect(tunnel.url).toBe(URL_);
    expect(calls.map((c) => c.args)).toEqual([
      ["tunnel", "token", "bot-dev"],
      ["tunnel", "--no-autoupdate", "--url", "http://localhost:5173", "run"],
    ]);
    expect(calls[1]!.env).toEqual({ TUNNEL_TOKEN: "secret-token" });
    await new Promise((r) => setTimeout(r, 200));
    expect(warnings).toEqual([]);
    await tunnel.close();
  });

  test("CLOUDFLARE_TUNNEL_TOKEN: runs the tunnel with it, without fetching one", async () => {
    const calls: { args: string[]; env: Record<string, string> }[] = [];
    const tunnel = await openTunnel(
      { name: "bot-dev", hostname: HOST },
      { port: 5173, root: ".", info: () => {}, tunnelToken: "secret-token", warn: () => {}, spawn: fake([], calls) },
    );
    expect(tunnel.url).toBe(URL_);
    expect(calls.map((c) => c.args)).toEqual([["tunnel", "--no-autoupdate", "--url", "http://localhost:5173", "run"]]);
    expect(calls[0]!.env).toEqual({ TUNNEL_TOKEN: "secret-token" });
    await tunnel.close();
  });

  test("warns when the dashboard routes the hostname to another port", async () => {
    const warnings: string[] = [];
    const tunnel = await openTunnel(
      { name: "bot-dev", hostname: HOST },
      {
        port: 5173,
        root: ".",
        info: () => {},
        tunnelToken: "secret-token",
        warn: (m) => warnings.push(m),
        spawn: fake([{ hostname: HOST, service: "http://localhost:8787" }, { service: "http_status:404" }]),
      },
    );
    for (let i = 0; i < 40 && warnings.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
    expect(warnings[0]).toContain("routes bot-dev.example.com to http://localhost:8787, but vite dev listens on http://localhost:5173");
    await tunnel.close();
  });

  test("a token that cannot be fetched says how to log in", async () => {
    await expect(openTunnel({ name: "nope", hostname: HOST }, { port: 5173, root: ".", info: () => {}, warn: () => {}, spawn: fake([]) })).rejects.toThrow(
      "cloudflared tunnel token nope failed (ERR unknown tunnel): run `cloudflared tunnel login`, or set CLOUDFLARE_TUNNEL_TOKEN",
    );
  });

  test("cloudflared exiting before it connects fails with its last line", async () => {
    await expect(openTunnel({ name: "bot-dev", hostname: HOST }, { port: 5173, root: ".", info: () => {}, tunnelToken: "wrong", warn: () => {}, spawn: fake([]) })).rejects.toThrow(
      "before connecting tunnel bot-dev: ERR bad token",
    );
  });

  test("cloudflared not installed says so", async () => {
    const missing: SpawnCloudflared = () => spawn("composure-no-such-cloudflared", [], { stdio: ["ignore", "pipe", "pipe"] });
    await expect(
      openTunnel({ name: "bot-dev", hostname: HOST }, { port: 5173, root: ".", info: () => {}, tunnelToken: "secret-token", warn: () => {}, spawn: missing }),
    ).rejects.toThrow("cloudflared is not installed");
  });
});

describe("routeProblem", () => {
  const port = 5173;
  test("fine when the host goes to this server", () => {
    expect(routeProblem([{ hostname: "bot-dev.example.com", service: "http://localhost:5173" }], URL_, port)).toBeUndefined();
    expect(routeProblem([{ hostname: "*.example.com", service: "http://127.0.0.1:5173" }], URL_, port)).toBeUndefined();
    // A locally managed tunnel reports no routes: --url applies.
    expect(routeProblem([], URL_, port)).toBeUndefined();
  });
  test("names what is wrong", () => {
    expect(routeProblem([{ hostname: "other.example.com", service: "http://localhost:5173" }], URL_, port)).toBe("has no route for bot-dev.example.com (other.example.com)");
    expect(routeProblem([{ hostname: "bot-dev.example.com", service: "http://10.0.0.2:5173" }], URL_, port)).toContain("routes bot-dev.example.com to http://10.0.0.2:5173");
    expect(routeProblem([{ hostname: "bot-dev.example.com", service: "http_status:404" }], URL_, port)).toContain("to http_status:404");
  });
});
