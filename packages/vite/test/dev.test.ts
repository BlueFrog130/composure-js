// The Dev Loop against a real `vite dev` server and a throwaway bot project. Discord is a recording
// Transport and the Tunnel a stand-in: nothing leaves the machine.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { createLogger, createServer, type InlineConfig, type ViteDevServer } from "vite";
import { chatInput, TestKey, TestResponse } from "composurejs/testing";
import composure, { type DevOptions, server as serverPlugin, type Tunnel } from "../src/index.ts";

const APP_ID = "1052322265397739523";
const GUILD = "798662131062931547";
const key = await TestKey.generate();
const other = await TestKey.generate();

const appSource = (reply: string, extra = "") => `
import { App, Button, command, Row } from "composurejs"
export const app = new App()
  .command(command({ name: "hello", description: "Hi", handler: () => <Row><Button onClick={(c) => c.reply("${reply}")}>Go</Button></Row> }))
  ${extra}
`;

let dir: string;
let server: ViteDevServer | undefined;
const cleanup: (() => unknown)[] = [];

/** A bot project whose `.env.local` holds these secrets (and the App's public key). */
function project(env: Record<string, string> = {}, source = appSource("v1")): string {
  dir = fileURLToPath(new URL(`./.tmp/${Math.random().toString(36).slice(2)}/`, import.meta.url));
  mkdirSync(`${dir}src`, { recursive: true });
  writeFileSync(`${dir}package.json`, JSON.stringify({ type: "module" }));
  writeFileSync(`${dir}tsconfig.json`, JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "composurejs" } }));
  writeFileSync(
    `${dir}.env.local`,
    Object.entries({ DISCORD_PUBLIC_KEY: key.publicKey, ...env })
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  );
  writeFileSync(`${dir}src/app.tsx`, source);
  return dir;
}

type Answer = (request: Request) => Response | undefined;

/** Records Discord calls (into `events` too) and answers each like Discord would, by route; `answer` goes first. */
function discord(events: string[] = [], answer: Answer = () => undefined) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const transport = async (request: Request) => {
    const path = new URL(request.url).pathname.replace("/api/v10", "");
    const body = request.method === "GET" ? undefined : await request.clone().json();
    calls.push({ method: request.method, path, body });
    if (request.method === "PATCH") events.push(`PATCH ${(body as { interactions_endpoint_url: string }).interactions_endpoint_url}`);
    const scripted = answer(request);
    if (scripted) return scripted;
    if (path === "/applications/@me") return Response.json(request.method === "GET" ? { id: APP_ID, verify_key: key.publicKey } : {});
    return Response.json([]);
  };
  return { calls, transport };
}

async function start(dev: DevOptions | undefined, logs: string[] = [], extra: InlineConfig = {}) {
  const logger = createLogger("info");
  logger.info = (msg) => void logs.push(msg);
  logger.warn = (msg) => void logs.push(msg);
  server = await createServer({
    root: dir,
    configFile: false,
    customLogger: logger,
    plugins: [composure(dev === undefined ? {} : { dev }), serverPlugin()],
    server: { port: 0, host: "127.0.0.1", hmr: false },
    ...extra,
  });
  await server.listen();
  return (server.httpServer!.address() as AddressInfo).port;
}

function post(port: number, body: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path: "/interactions", method: "POST", headers: { "content-type": "application/json", ...headers } }, (res) => {
      let text = "";
      res.on("data", (c: Buffer) => (text += c.toString()));
      res.on("end", () => resolve({ status: res.statusCode!, text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function ask(port: number, interaction: { build(): unknown }) {
  const payload = interaction.build();
  const body = JSON.stringify(payload);
  const res = await post(port, body, await key.sign(body));
  return TestResponse.of(res.status, JSON.parse(res.text), [], payload as never);
}

/** A Tunnel that is this server itself: the probe gets the App's real answer. */
const local =
  (onClose = () => {}) =>
  async (port: number): Promise<Tunnel> => ({ url: `http://127.0.0.1:${port}`, close: async () => onClose() });

/**
 * A tunnel's far end on a host nothing resolves (`bot.test`), known to be at 127.0.0.1: answers
 * `/interactions` with each status in turn (the last one repeats), recording each into `events`.
 */
async function farEnd(statuses: number[], events: string[]): Promise<(port: number) => Promise<Tunnel>> {
  const stand: Server = createHttpServer((req, res) => {
    const status = statuses.length > 1 ? statuses.shift()! : statuses[0]!;
    events.push(`probe ${req.method} ${req.headers.host}${req.url} ${status}`);
    res.writeHead(status).end();
  });
  await new Promise<void>((resolve) => stand.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => stand.close());
  const { port } = stand.address() as AddressInfo;
  return async () => ({ url: `http://bot.test:${port}`, address: "127.0.0.1", close: async () => {} });
}

const until = async (check: () => boolean | Promise<boolean>, ms = 5000) => {
  for (const start = Date.now(); !(await check());) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};
const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Writes the App's source, and saves it again each second until `check` holds: on Windows the
 * watcher can miss a write made right after it is ready.
 */
const edit = async (source: string, check: () => boolean | Promise<boolean>, ms = 8000) => {
  let saved = 0;
  await until(async () => {
    if (Date.now() - saved > 1000) {
      writeFileSync(`${dir}src/app.tsx`, source);
      saved = Date.now();
    }
    return check();
  }, ms);
};

afterEach(async () => {
  await server?.close();
  server = undefined;
  for (const fn of cleanup.splice(0)) await fn();
  rmSync(dir, { recursive: true, force: true });
});

describe("vite dev", { timeout: 30_000 }, () => {
  test("without dev, there is no Dev Loop", async () => {
    project({ DISCORD_TOKEN: "t" });
    const logs: string[] = [];
    // Outside Vitest, so only the missing `dev` keeps it off.
    const vitest = process.env.VITEST;
    delete process.env.VITEST;
    try {
      const port = await start(undefined, logs);
      expect((await post(port, "{}")).status).toBe(401);
      await settle();
    } finally {
      process.env.VITEST = vitest;
    }
    expect(logs.join("\n")).not.toContain("[composure]");
  });

  test("under Vitest without dev.transport, the Dev Loop stays off", async () => {
    project({ DISCORD_TOKEN: "t" });
    const logs: string[] = [];
    let opened = false;
    const port = await start({ application: APP_ID, guild: GUILD, tunnel: async (p) => ((opened = true), local()(p)) }, logs);
    // server() still serves the App locally; nothing reaches Discord.
    expect((await post(port, "{}")).status).toBe(401);
    await settle();
    expect(opened).toBe(false);
    expect(logs.join("\n")).not.toContain("[composure]");
  });

  test("warns once when .env sets DISCORD_TOKEN: Vite loads .env in every mode", async () => {
    project();
    writeFileSync(`${dir}.env`, "# production\nDISCORD_TOKEN=production-token\n");
    const logs: string[] = [];
    await start({ tunnel: false, transport: discord().transport }, logs);
    await settle();
    expect(logs.filter((l) => l.includes(".env sets DISCORD_TOKEN"))).toHaveLength(1);
  });

  test("no .env warning for DISCORD_TOKEN in .env.local, or a .env without it", async () => {
    project({ DISCORD_TOKEN: "t" });
    writeFileSync(`${dir}.env`, "OTHER=1\n# DISCORD_TOKEN=commented out\n");
    const logs: string[] = [];
    await start({ tunnel: false, transport: discord().transport }, logs);
    await settle();
    expect(logs.join("\n")).not.toContain(".env sets DISCORD_TOKEN");
  });

  test("serves the App with its handlers compiled, and picks up edits without a restart", async () => {
    project();
    const port = await start({ tunnel: false, transport: discord().transport });
    const first = await ask(port, chatInput("hello"));
    expect((await ask(port, first.click("Go"))).text).toBe("v1");
    expect((await post(port, "{}")).status).toBe(401);

    writeFileSync(`${dir}src/app.tsx`, appSource("v2"));
    // The watcher invalidates the module shortly after the write.
    let text: string | undefined;
    for (let i = 0; i < 80 && text !== "v2"; i++) {
      const again = await ask(port, chatInput("hello"));
      text = (await ask(port, again.click("Go"))).text;
      if (text !== "v2") await new Promise((r) => setTimeout(r, 100));
    }
    expect(text).toBe("v2");
  });

  test("Repoint: probes the tunnel, pinned to its address, until a 401, then points the Dev Application at it", async () => {
    const events: string[] = [];
    const { calls, transport } = discord(events);
    project({ DISCORD_TOKEN: "t" });
    const tunnel = await farEnd([502, 401], events);
    const logs: string[] = [];
    await start({ application: APP_ID, tunnel, transport }, logs);
    await until(() => events.some((e) => e.startsWith("PATCH")));
    const host = events[0]!.split(" ")[2]!.replace("/interactions", "");
    expect(events).toEqual([`probe POST ${host}/interactions 502`, `probe POST ${host}/interactions 401`, `PATCH http://${host}/interactions`]);
    expect(calls.find((c) => c.method === "PATCH")).toEqual({ method: "PATCH", path: "/applications/@me", body: { interactions_endpoint_url: `http://${host}/interactions` } });
    await until(() => logs.some((l) => l.includes("Dev Application")));
    const out = logs.join("\n");
    expect(out).toContain(`tunnel connected http://${host}`);
    expect(out).toMatch(new RegExp(`Dev Application ${APP_ID} → http://${host}/interactions \\(\\d+\\.\\ds\\)`));
  });

  test("Repoint: never repoints when dev.application is not the token's application; prints the URL instead", async () => {
    const { calls, transport } = discord();
    project({ DISCORD_TOKEN: "t" });
    const logs: string[] = [];
    const port = await start({ application: "1111111111111111111", tunnel: local(), transport }, logs);
    await until(() => logs.some((l) => l.includes("by hand")));
    await settle();
    expect(calls.filter((c) => c.method === "PATCH")).toEqual([]);
    expect(logs.join("\n")).toContain(`Set the Interactions Endpoint URL by hand: http://127.0.0.1:${port}/interactions`);
  });

  test("Repoint: without dev.application, opens the tunnel and prints the URL to set by hand", async () => {
    const { calls, transport } = discord();
    project({ DISCORD_TOKEN: "t" });
    const logs: string[] = [];
    const port = await start({ tunnel: local(), transport }, logs);
    await until(() => logs.some((l) => l.includes("by hand")));
    await settle();
    expect(calls.filter((c) => c.method === "PATCH")).toEqual([]);
    expect(logs.join("\n")).toContain(`dev.application`);
    expect(logs.join("\n")).toContain(`http://127.0.0.1:${port}/interactions`);
  });

  test("Repoint: a 429 waits retry_after, then PATCHes again", async () => {
    let limited = 1;
    const { calls, transport } = discord([], (request) =>
      request.method === "PATCH" && limited-- > 0 ? Response.json({ message: "You are being rate limited.", retry_after: 0.4, global: false }, { status: 429 }) : undefined,
    );
    project({ DISCORD_TOKEN: "t" });
    const logs: string[] = [];
    await start({ application: APP_ID, tunnel: local(), transport }, logs);
    await until(() => logs.some((l) => l.includes("Dev Application")));
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(2);
    expect(logs.join("\n")).toContain("rate limited; retrying in 0.4s");
  });

  test("Repoint: a 400 with another application's DISCORD_PUBLIC_KEY fails naming the key", async () => {
    const { calls, transport } = discord([], (request) => (request.method === "PATCH" ? Response.json({ code: 50035, message: "Invalid Form Body" }, { status: 400 }) : undefined));
    project({ DISCORD_TOKEN: "t", DISCORD_PUBLIC_KEY: other.publicKey });
    const logs: string[] = [];
    const port = await start({ application: APP_ID, tunnel: local(), transport }, logs);
    await until(() => logs.some((l) => l.includes("failed")));
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(logs.join("\n")).toContain(`repoint failed: DISCORD_PUBLIC_KEY is not the public key of application ${APP_ID}`);
    // vite dev keeps serving.
    expect((await post(port, "{}")).status).toBe(401);
  });

  test("a Tunnel that fails names its stage, and vite dev keeps serving", async () => {
    const { transport } = discord();
    project({ DISCORD_TOKEN: "t" });
    const logs: string[] = [];
    const port = await start(
      {
        application: APP_ID,
        transport,
        tunnel: async () => {
          throw new Error("no route to the edge");
        },
      },
      logs,
    );
    await until(() => logs.some((l) => l.includes("failed")));
    expect(logs.join("\n")).toContain("tunnel failed: no route to the edge");
    expect((await post(port, "{}")).status).toBe(401);
  });

  test("the Tunnel closes with the server", async () => {
    const { transport } = discord();
    project({ DISCORD_TOKEN: "t" });
    let closed = false;
    const logs: string[] = [];
    await start({ application: APP_ID, tunnel: local(() => (closed = true)), transport }, logs);
    await until(() => logs.some((l) => l.includes("Dev Application")));
    await server!.close();
    server = undefined;
    expect(closed).toBe(true);
  });

  test("dev Sync: Commands to dev.guild on start, and again on change", async () => {
    const { calls, transport } = discord();
    project({ DISCORD_TOKEN: "t" });
    const logs: string[] = [];
    await start({ guild: GUILD, tunnel: false, transport }, logs);
    await until(() => calls.some((c) => c.method === "PUT"));
    expect(calls.find((c) => c.method === "PUT")).toEqual({
      method: "PUT",
      path: `/applications/${APP_ID}/guilds/${GUILD}/commands`,
      body: [{ type: 1, name: "hello", description: "Hi" }],
    });
    expect(logs.join("\n")).toContain(`dev Sync to guild ${GUILD}: 1 to create, 0 to update, 0 to delete`);

    await edit(appSource("v1", `.command(command({ name: "bye", description: "Bye", handler: () => "bye" }))`), () => calls.filter((c) => c.method === "PUT").length === 2);
    await settle(1500);
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(2);
    expect((puts[1]!.body as { name: string }[]).map((c) => c.name)).toEqual(["hello", "bye"]);
  });

  test("dev Sync: an edit that leaves the Definitions unchanged sends nothing", async () => {
    const { calls, transport } = discord();
    project({ DISCORD_TOKEN: "t" });
    const logs: string[] = [];
    const port = await start({ guild: GUILD, tunnel: false, transport }, logs);
    const bye = `.command(command({ name: "bye", description: "Bye", handler: () => "bye" }))`;
    // The start Sync first, or it may read the edit below and leave the change nothing to send.
    await until(() => calls.some((c) => c.method === "PUT"));
    // A synced change next: the watcher is known to be live before the edit under test.
    await edit(appSource("v1", bye), () => calls.filter((c) => c.method === "PUT").length === 2);
    await settle(1000);
    const before = calls.length;

    // Only a handler's body changes: the served App changes, its Definitions do not.
    await edit(appSource("v2", bye), async () => (await ask(port, (await ask(port, chatInput("hello"))).click("Go"))).text === "v2");
    await settle(1500);
    expect(calls.slice(before)).toEqual([]);
  });

  test("dev Sync: without dev.guild, nothing is synced", async () => {
    const { calls, transport } = discord();
    project({ DISCORD_TOKEN: "t" });
    const logs: string[] = [];
    const port = await start({ tunnel: false, transport }, logs);
    await edit(appSource("v1", `.command(command({ name: "bye", description: "Bye", handler: () => "bye" }))`), async () => (await ask(port, chatInput("bye"))).text === "bye");
    await settle(1500);
    expect(calls).toEqual([]);
    expect(logs.join("\n")).not.toContain("dev Sync");
  });

  test("dev Sync: a failing Sync is logged, vite dev keeps serving, and the next change syncs again", async () => {
    let failing = true;
    const { calls, transport } = discord([], (request) =>
      failing && request.method === "PUT" ? Response.json({ code: 50035, message: "Invalid Form Body" }, { status: 400 }) : undefined,
    );
    project({ DISCORD_TOKEN: "t" });
    const logs: string[] = [];
    const port = await start({ guild: GUILD, tunnel: false, transport }, logs);
    await until(() => logs.some((l) => l.includes("dev Sync failed")));
    expect(logs.join("\n")).toMatch(/dev Sync failed: .*Invalid Form Body/);
    expect((await ask(port, chatInput("hello"))).status).toBe(200);

    failing = false;
    await edit(appSource("v1", `.command(command({ name: "bye", description: "Bye", handler: () => "bye" }))`), () => logs.some((l) => l.includes(`dev Sync to guild ${GUILD}`)));
    expect((calls.filter((c) => c.method === "PUT").at(-1)!.body as { name: string }[]).map((c) => c.name)).toEqual(["hello", "bye"]);
  });

  test("dev Sync: a broken App is logged, and vite dev keeps running", async () => {
    const { calls, transport } = discord();
    project({ DISCORD_TOKEN: "t" }, `export const app = (() => { throw new Error("bad Definition") })()`);
    const logs: string[] = [];
    const port = await start({ guild: GUILD, tunnel: false, transport }, logs);
    await until(() => logs.some((l) => l.includes("dev Sync failed")));
    expect(logs.join("\n")).toContain("dev Sync failed: bad Definition");
    expect(calls.filter((c) => c.method === "PUT")).toEqual([]);

    await edit(appSource("v1"), () => calls.some((c) => c.method === "PUT"));
    expect((await ask(port, chatInput("hello"))).status).toBe(200);
  });

  test("dev Sync: runs while the Tunnel is still connecting", async () => {
    const { calls, transport } = discord();
    project({ DISCORD_TOKEN: "t" });
    const logs: string[] = [];
    let connect!: (tunnel: Tunnel) => void;
    let opening = false;
    await start(
      {
        application: APP_ID,
        guild: GUILD,
        transport,
        tunnel: () => {
          opening = true;
          return new Promise((resolve) => {
            connect = resolve;
          });
        },
      },
      logs,
    );
    await until(() => calls.some((c) => c.method === "PUT"));
    expect(opening).toBe(true);
    expect(logs.join("\n")).not.toContain("tunnel connected");

    connect(await local()((server!.httpServer!.address() as AddressInfo).port));
    await until(() => logs.some((l) => l.includes("Dev Application")));
  });
});

describe("Vite's host check", { timeout: 30_000 }, () => {
  test('tunnel "quick" (the default) allows .trycloudflare.com, and nothing else', async () => {
    project();
    const port = await start({});
    expect((await post(port, "{}", { host: "bosnia-settled-trades-width.trycloudflare.com" })).status).toBe(401);
    expect((await post(port, "{}", { host: "evil.example.com" })).status).toBe(403);
  });

  test("tunnel { url } allows its host", async () => {
    project();
    const port = await start({ tunnel: { url: "https://bot-dev.ngrok.app" } });
    expect((await post(port, "{}", { host: "bot-dev.ngrok.app" })).status).toBe(401);
    expect((await post(port, "{}", { host: "x.trycloudflare.com" })).status).toBe(403);
  });

  test("tunnel { name, hostname } allows its hostname", async () => {
    project();
    const port = await start({ tunnel: { name: "bot-dev", hostname: "dev.example.com" } });
    expect((await post(port, "{}", { host: "dev.example.com" })).status).toBe(401);
    expect((await post(port, "{}", { host: "x.trycloudflare.com" })).status).toBe(403);
  });
});
