// The CLI against the example bot: its App is loaded through Vite with @composurejs/vite, so its
// Inline Handlers compile; Discord is a MockTransport and the UI is recorded.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MockTransport } from "composurejs/testing";
import { type Io, main } from "../src/cli.ts";
import { recordingUi } from "../src/ui.ts";

const EXAMPLE = fileURLToPath(new URL("../../../examples/bot", import.meta.url));
const APP_ID = "1052322265397739523";
const COMMANDS = ["/ping", "/hello", "/cookie", "High five (user)", "/server", "/poll", "/feedback", "/counter", "/report"];

function run(options: { env?: Record<string, string>; confirm?: boolean; stored?: object[]; envFiles?: boolean } = {}) {
  const ui = recordingUi(options.confirm);
  const out: string[] = [];
  const err: string[] = [];
  const transport = new MockTransport().reply(200, options.stored ?? []);
  const io: Io = {
    // With envFiles, everything else comes from the project's files.
    env: options.envFiles ? { ...options.env } : { DISCORD_TOKEN: "t", DISCORD_APPLICATION_ID: APP_ID, ...options.env },
    ui,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    transport: transport.fetch,
    // Never the developer's real .env.
    readEnvFiles: options.envFiles ?? false,
  };
  return { io, ui, out, err, transport, main: (...args: string[]) => main(args, io) };
}

const sync = (...args: string[]) => ["sync", "--root", EXAMPLE, ...args];

describe("composure sync", { timeout: 30_000 }, () => {
  test("--dry-run loads the App through Vite and shows the plan", async () => {
    const t = run();
    expect(await t.main(...sync("--dry-run"))).toBe(0);
    expect(t.ui.lines[0]).toBe("intro: composure sync");
    expect(t.ui.lines[1]).toBe("step: Loaded src/app.tsx: 9 Commands");
    expect(t.ui.lines[2]).toBe("step: 9 to create, 0 to update, 0 to delete");
    expect(t.ui.lines[3]).toBe(`note(Sync Plan):\nglobal:\n${COMMANDS.map((c) => `  + ${c}`).join("\n")}\n9 to create, 0 to update, 0 to delete`);
    expect(t.ui.lines.at(-1)).toBe("outro: Dry run: nothing applied.");
    expect(t.transport.requests.map((r) => r.method)).toEqual(["GET"]);
  });

  test("--check exits 2 when Discord is out of date", async () => {
    const t = run();
    expect(await t.main(...sync("--check"))).toBe(2);
    expect(t.ui.lines.at(-1)).toBe("fail: Discord is out of date.");
  });

  test("without a terminal, applying needs --yes", async () => {
    const t = run();
    expect(await t.main(...sync())).toBe(1);
    expect(t.ui.lines.at(-1)).toMatch(/^fail: Not applied: pass --yes/);
    expect(t.transport.requests.map((r) => r.method)).toEqual(["GET"]);
  });

  test("--yes applies with one bulk overwrite", async () => {
    const t = run();
    expect(await t.main(...sync("--yes"))).toBe(0);
    expect(t.ui.lines.slice(-2)).toEqual(["step: Synced 9 changes", "outro: Discord is up to date."]);
    const put = t.transport.requests.find((r) => r.method === "PUT");
    expect(put?.path).toBe(`/applications/${APP_ID}/commands`);
    expect((put?.json as { name: string }[]).map((c) => c.name)).toContain("counter");
  });

  test("in a terminal it asks, warning about deletions; declining cancels", async () => {
    const stored = [{ id: "1", application_id: APP_ID, version: "1", type: 1, name: "old", description: "Gone from code" }];
    const yes = run({ confirm: true, stored });
    expect(await yes.main(...sync())).toBe(0);
    expect(yes.ui.lines).toContain("warn: 1 Command will be deleted from Discord.");
    expect(yes.ui.lines).toContain("confirm: Apply 10 changes? yes");
    const no = run({ confirm: false });
    expect(await no.main(...sync())).toBe(1);
    expect(no.ui.lines.slice(-2)).toEqual(["confirm: Apply 9 changes? no", "fail: Cancelled."]);
  });

  test("--guild sends everything to one guild", async () => {
    const t = run();
    await t.main(...sync("--guild", "798662131062931547", "--yes"));
    expect(t.ui.lines[2]).toBe("step: 9 to create, 0 to update, 0 to delete");
    expect(t.transport.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `GET /applications/${APP_ID}/guilds/798662131062931547/commands?with_localizations=true`,
      `PUT /applications/${APP_ID}/guilds/798662131062931547/commands`,
    ]);
  });

  test("commander handles help, version and usage errors", async () => {
    const help = run();
    expect(await help.main("sync", "--help")).toBe(0);
    expect(help.out.join("\n")).toMatch(/^Usage: composure sync \[options\]/);
    expect(help.out.join("\n")).toContain("COMPOSURE_SCOPE_<NAME>");
    const version = run();
    expect(await version.main("--version")).toBe(0);
    expect(version.out).toEqual(["0.0.0"]);
    const conflict = run();
    expect(await conflict.main(...sync("--check", "--yes"))).toBe(1);
    expect(conflict.err.join("\n")).toMatch(/option '--check' cannot be used with option '-y, --yes'/);
    const badGuild = run();
    expect(await badGuild.main(...sync("--guild", "abc"))).toBe(1);
    expect(badGuild.err.join("\n")).toMatch(/not a guild id/);
  });

  test("--help describes .env.local and .env.production.local", async () => {
    const help = run();
    expect(await help.main("sync", "--help")).toBe(0);
    const text = help.out.join("\n");
    expect(text).toContain(".env.local");
    expect(text).toContain(".env.production.local");
    expect(text).not.toContain(".dev.vars");
  });

  test("missing configuration fails with what to fix", async () => {
    const noToken = run({ env: { DISCORD_TOKEN: "" } });
    expect(await noToken.main(...sync("--dry-run"))).toBe(1);
    expect(noToken.ui.lines.at(-1)).toBe("fail: DISCORD_TOKEN is not set");
    const noApp = run();
    expect(await noApp.main(...sync("--dry-run", "--app", "src/nope.ts"))).toBe(1);
    expect(noApp.ui.lines.slice(-2)).toEqual(["step failed: Loading src/nope.ts", "fail: src/nope.ts does not exist; pass --app <file exporting the App>"]);
  });
});

// Env files in a throwaway project with an empty App: which application id reaches Discord
// shows which file won.
describe("composure sync env files", { timeout: 30_000 }, () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "composure-cli-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/app.ts"), "export const app = { definitions: () => [] }\n");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const files = (entries: Record<string, string>) => {
    for (const [name, id] of Object.entries(entries)) writeFileSync(join(root, name), `DISCORD_TOKEN=t\nDISCORD_APPLICATION_ID=${id}\n`);
  };
  async function syncedTo(...args: string[]): Promise<string | undefined> {
    const t = run({ envFiles: true });
    expect(await t.main("sync", "--root", root, "--dry-run", ...args)).toBe(0);
    return t.transport.requests[0]?.path.split("/")[2];
  }
  async function warnings(env: Record<string, string>, ...args: string[]): Promise<string[]> {
    const t = run({ envFiles: true, env });
    expect(await t.main("sync", "--root", root, "--dry-run", ...args)).toBe(0);
    return t.ui.lines.filter((l) => l.startsWith("warn: "));
  }

  test("production mode warns when DISCORD_TOKEN comes from .env.local, and still syncs with it", async () => {
    files({ ".env.local": "111111111111111111" });
    const lines = await warnings({});
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^warn: DISCORD_TOKEN comes from \.env\.local/);
    expect(lines[0]).toContain(".env.production.local");
    expect(await syncedTo()).toBe("111111111111111111");
  });

  test("a partial .env.production.local without DISCORD_TOKEN warns too", async () => {
    files({ ".env.local": "111111111111111111" });
    writeFileSync(join(root, ".env.production.local"), "DISCORD_APPLICATION_ID=222222222222222222\n");
    expect(await warnings({})).toHaveLength(1);
  });

  test("no warning when DISCORD_TOKEN comes from .env.production.local or the process env, or in development mode", async () => {
    files({ ".env.local": "111111111111111111", ".env.production.local": "222222222222222222" });
    expect(await warnings({})).toEqual([]);
    rmSync(join(root, ".env.production.local"));
    expect(await warnings({ DISCORD_TOKEN: "from-ci" })).toEqual([]);
    expect(await warnings({}, "--mode", "development")).toEqual([]);
  });

  test("production mode (the default) takes .env.production.local over .env.local", async () => {
    files({ ".env.local": "111111111111111111", ".env.production.local": "222222222222222222" });
    expect(await syncedTo()).toBe("222222222222222222");
  });

  test("development mode reads .env.local and never .env.production.local", async () => {
    files({ ".env.local": "111111111111111111", ".env.production.local": "222222222222222222" });
    expect(await syncedTo("--mode", "development")).toBe("111111111111111111");
  });

  test(".dev.vars is not read", async () => {
    files({ ".dev.vars": "333333333333333333" });
    const t = run({ envFiles: true });
    expect(await t.main("sync", "--root", root, "--dry-run")).toBe(1);
    expect(t.ui.lines.at(-1)).toBe("fail: DISCORD_TOKEN is not set");
    expect(t.ui.lines.filter((l) => l.startsWith("warn: "))).toEqual([]);
  });
});
