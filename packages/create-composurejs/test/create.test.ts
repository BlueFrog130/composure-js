import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";
import { type Env, main } from "../src/create.ts";
import { generate, type Template } from "../src/templates.ts";

const VERSIONS = { composurejs: "^1.2.3", cli: "^1.0.0", vitePlugin: "^1.1.0", vite: "^8.3.5" };
const tmp = fileURLToPath(new URL("./.tmp/", import.meta.url));

function env(overrides: Partial<Env> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const installs: string[] = [];
  const value: Env = {
    cwd: tmp,
    userAgent: "pnpm/12.8.0 node/v26.8.1",
    interactive: false,
    versions: VERSIONS,
    install: async (dir, pm) => (installs.push(`${pm} ${dir}`), true),
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    ...overrides,
  };
  return { env: value, out, err, installs };
}

// The terminal: each prompt takes the next queued answer and records its message. An answer its
// `validate` rejects is recorded in `rejected`, and the prompt takes the next one, as clack re-asks.
const prompts = vi.hoisted(() => ({ answers: [] as unknown[], asked: [] as string[], rejected: [] as string[] }));
vi.mock("@clack/prompts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clack/prompts")>();
  const answer = async ({ message, validate }: { message: string; validate?: (value: string | undefined) => string | Error | undefined }) => {
    prompts.asked.push(message);
    for (;;) {
      const value = prompts.answers.shift();
      const problem = typeof value === "string" ? validate?.(value) : undefined;
      if (!problem) return value;
      prompts.rejected.push(`${JSON.stringify(value)}: ${String(problem)}`);
    }
  };
  return { ...actual, text: answer, select: answer, confirm: answer };
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  prompts.answers.length = 0;
  prompts.asked.length = 0;
  prompts.rejected.length = 0;
});
// clack writes to stdout; keep test output readable.
vi.spyOn(process.stdout, "write").mockImplementation(() => true);

describe("generate", () => {
  test.each(["cloudflare", "node", "bun"] as Template[])("%s: the shared App and tests, plus its entry", (template) => {
    const files = generate(template, "my-bot", VERSIONS);
    for (const path of [
      "package.json",
      "tsconfig.json",
      "vite.config.ts",
      "vitest.config.ts",
      "src/app.tsx",
      "src/counter.tsx",
      "test/app.test.ts",
      ".env.example",
      ".gitignore",
      "README.md",
    ]) {
      expect(files, path).toHaveProperty([path]);
    }
    const pkg = JSON.parse(files["package.json"]!);
    expect(pkg).toMatchObject({ name: "my-bot", type: "module", dependencies: { composurejs: "^1.2.3" } });
    expect(pkg.devDependencies).toMatchObject({ "@composurejs/vite": "^1.1.0", "@composurejs/cli": "^1.0.0", vite: "^8.3.5" });
    expect(files["vite.config.ts"]).toContain(template === "cloudflare" ? "plugins: [composure({ dev: {} }), cloudflare()]" : "plugins: [composure({ dev: {} }), server()]");
    expect(files["vitest.config.ts"]).toContain("plugins: [composure()]");
  });

  test("cloudflare gets a Worker entry, wrangler config and deploy; node and bun a server entry and start", () => {
    const cf = generate("cloudflare", "cf-bot", VERSIONS);
    expect(Object.keys(cf)).toEqual(expect.arrayContaining(["src/worker.ts", "wrangler.jsonc"]));
    expect(JSON.parse(cf["wrangler.jsonc"]!)).toMatchObject({ name: "cf-bot", main: "src/worker.ts" });
    expect(JSON.parse(cf["package.json"]!).scripts.deploy).toBe("vite build && wrangler deploy");
    expect(JSON.parse(generate("node", "n", VERSIONS)["package.json"]!).scripts.start).toBe("node --env-file-if-exists=.env.production.local dist/index.js");
    for (const template of ["node", "bun"] as const) {
      const files = generate(template, "s", VERSIONS);
      // The plugin builds the Default Server around src/app.tsx: no entry file, no extra dependency.
      expect(Object.keys(files).filter((f) => f.startsWith("src/"))).toEqual(["src/app.tsx", "src/counter.tsx"]);
      expect(files["vite.config.ts"]).toContain("plugins: [composure({ dev: {} }), server()]");
      expect(JSON.parse(files["package.json"]!).dependencies).toEqual({ composurejs: "^1.2.3" });
    }
    expect(JSON.parse(cf["package.json"]!).dependencies).toEqual({ composurejs: "^1.2.3" });
  });

  test.each(["cloudflare", "node", "bun"] as Template[])("%s: secrets in .env.local (dev) and .env.production.local, never .dev.vars", (template) => {
    const files = generate(template, "my-bot", VERSIONS);
    for (const path of [".env.example", "README.md"]) {
      expect(files[path], path).toContain(".env.local");
      expect(files[path], path).toContain(".env.production.local");
      expect(files[path], path).not.toMatch(/\.dev\.vars|COMPOSURE_DEV_/);
    }
    expect(files[".gitignore"]).not.toContain(".dev.vars");
    // How to fill dev in after skipping the questions.
    expect(files["README.md"]).toMatch(/dev: \{ application: "<id>", guild: "<id>" \}/);
    const start = JSON.parse(files["package.json"]!).scripts.start;
    if (template === "node") expect(start).toBe("node --env-file-if-exists=.env.production.local dist/index.js");
    // bun loads .env.local by default; --env-file loads only production's.
    if (template === "bun") expect(start).toBe("bun --env-file=.env.production.local dist/index.js");
  });
});

describe("create-composurejs", () => {
  test("writes the template and installs with the package manager that ran it", async () => {
    const t = env();
    expect(await main(["my-bot", "--template", "node"], t.env)).toBe(0);
    expect(JSON.parse(readFileSync(`${tmp}my-bot/package.json`, "utf8")).name).toBe("my-bot");
    expect(existsSync(`${tmp}my-bot/src/app.tsx`)).toBe(true);
    expect(t.installs).toHaveLength(1);
    expect(t.installs[0]).toMatch(/^pnpm .*my-bot$/);
  });

  test("defaults without a terminal: my-bot, cloudflare; --no-install skips installing", async () => {
    const t = env();
    expect(await main(["--no-install"], t.env)).toBe(0);
    expect(existsSync(`${tmp}my-bot/wrangler.jsonc`)).toBe(true);
    expect(t.installs).toEqual([]);
  });

  test("refuses a non-empty directory without a terminal, and bad names or templates", async () => {
    mkdirSync(`${tmp}taken`, { recursive: true });
    writeFileSync(`${tmp}taken/file.txt`, "x");
    expect(await main(["taken", "--no-install"], env().env)).toBe(1);
    expect(readFileSync(`${tmp}taken/file.txt`, "utf8")).toBe("x");
    const bad = env();
    expect(await main(["x", "--template", "deno"], bad.env)).toBe(1);
    expect(bad.err.join("\n")).toMatch(/argument 'deno' is invalid. Allowed choices are cloudflare, node, bun/);
  });

  test("asks for the Dev Application and dev guild ids and writes them into vite.config.ts", async () => {
    prompts.answers.push("1100000000000000001", "1200000000000000002");
    expect(await main(["my-bot", "--template", "node", "--no-install"], env({ interactive: true }).env)).toBe(0);
    expect(prompts.asked).toEqual([expect.stringMatching(/Dev Application/), expect.stringMatching(/guild/)]);
    expect(readFileSync(`${tmp}my-bot/vite.config.ts`, "utf8")).toContain(`composure({ dev: { application: "1100000000000000001", guild: "1200000000000000002" } })`);
  });

  test("an id pasted with spaces around it is accepted, and written trimmed; anything else but digits is not", async () => {
    prompts.answers.push(" 1100000000000000001 ", "12OO", "1200000000000000002\n");
    expect(await main(["my-bot", "--template", "node", "--no-install"], env({ interactive: true }).env)).toBe(0);
    expect(prompts.rejected).toEqual(['"12OO": A Discord id is digits only']);
    expect(readFileSync(`${tmp}my-bot/vite.config.ts`, "utf8")).toContain(`composure({ dev: { application: "1100000000000000001", guild: "1200000000000000002" } })`);
  });

  test("both questions skipped: dev: {}, filled in later", async () => {
    prompts.answers.push("", "");
    expect(await main(["my-bot", "--template", "cloudflare", "--no-install"], env({ interactive: true }).env)).toBe(0);
    expect(prompts.asked).toHaveLength(2);
    expect(readFileSync(`${tmp}my-bot/vite.config.ts`, "utf8")).toContain("plugins: [composure({ dev: {} }), cloudflare()]");
  });

  test("--application and --guild skip the questions; without a terminal they default to dev: {}", async () => {
    expect(await main(["a", "-t", "bun", "--no-install", "--application", "11", "--guild", "22"], env({ interactive: true }).env)).toBe(0);
    expect(prompts.asked).not.toContainEqual(expect.stringMatching(/Dev Application|guild/));
    expect(readFileSync(`${tmp}a/vite.config.ts`, "utf8")).toContain(`composure({ dev: { application: "11", guild: "22" } })`);
    expect(await main(["b", "--no-install"], env().env)).toBe(0);
    expect(readFileSync(`${tmp}b/vite.config.ts`, "utf8")).toContain("composure({ dev: {} })");
    const bad = env();
    expect(await main(["c", "--no-install", "--guild", "my-server"], bad.env)).toBe(1);
    expect(existsSync(`${tmp}c`)).toBe(false);
  });

  test("help", async () => {
    const help = env();
    expect(await main(["--help"], help.env)).toBe(0);
    expect(help.out.join("\n")).toMatch(/^Usage: create-composurejs \[options\] \[dir\]/);
  });
});
