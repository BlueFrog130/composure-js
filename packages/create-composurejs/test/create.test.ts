import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, test, vi } from "vitest"
import { type Env, main } from "../src/create.ts"
import { generate, type Template } from "../src/templates.ts"

const VERSIONS = { composurejs: "^1.2.3", cli: "^1.0.0", vitePlugin: "^1.1.0", adapterNode: "^1.0.1", adapterBun: "^1.0.2", vite: "^8.3.5" }
const tmp = fileURLToPath(new URL("./.tmp/", import.meta.url))

function env(overrides: Partial<Env> = {}) {
  const out: string[] = []
  const err: string[] = []
  const installs: string[] = []
  const value: Env = {
    cwd: tmp,
    userAgent: "pnpm/12.8.0 node/v26.8.1",
    interactive: false,
    versions: VERSIONS,
    install: async (dir, pm) => (installs.push(`${pm} ${dir}`), true),
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    ...overrides,
  }
  return { env: value, out, err, installs }
}

afterEach(() => rmSync(tmp, { recursive: true, force: true }))
// clack writes to stdout; keep test output readable.
vi.spyOn(process.stdout, "write").mockImplementation(() => true)

describe("generate", () => {
  test.each(["cloudflare", "node", "bun"] as Template[])("%s: the shared App and tests, plus its entry", (template) => {
    const files = generate(template, "my-bot", VERSIONS)
    for (const path of ["package.json", "tsconfig.json", "vite.config.ts", "vitest.config.ts", "src/app.tsx", "src/counter.tsx", "test/app.test.ts", ".env.example", ".gitignore", "README.md"]) {
      expect(files, path).toHaveProperty([path])
    }
    const pkg = JSON.parse(files["package.json"]!)
    expect(pkg).toMatchObject({ name: "my-bot", type: "module", dependencies: { composurejs: "^1.2.3" } })
    expect(pkg.devDependencies).toMatchObject({ "@composurejs/vite": "^1.1.0", "@composurejs/cli": "^1.0.0", vite: "^8.3.5" })
    expect(files["vite.config.ts"]).toContain(`composure({ target: "${template}"`)
    expect(files["vitest.config.ts"]).toContain("plugins: [composure()]")
  })

  test("cloudflare gets a Worker entry, wrangler config and deploy; node and bun a server entry and start", () => {
    const cf = generate("cloudflare", "cf-bot", VERSIONS)
    expect(Object.keys(cf)).toEqual(expect.arrayContaining(["src/worker.ts", "wrangler.jsonc"]))
    expect(JSON.parse(cf["wrangler.jsonc"]!)).toMatchObject({ name: "cf-bot", main: "src/worker.ts" })
    expect(JSON.parse(cf["package.json"]!).scripts.deploy).toBe("vite build && wrangler deploy")
    expect(JSON.parse(generate("node", "n", VERSIONS)["package.json"]!).scripts.start).toBe("node --env-file-if-exists=.env dist/index.js")
    expect(generate("bun", "b", VERSIONS)["src/bun.ts"]).toContain(`import { handle } from "@composurejs/adapter-bun"`)
    expect(JSON.parse(generate("node", "n", VERSIONS)["package.json"]!).dependencies).toMatchObject({ "@composurejs/adapter-node": "^1.0.1" })
    expect(JSON.parse(generate("bun", "b", VERSIONS)["package.json"]!).dependencies).toMatchObject({ "@composurejs/adapter-bun": "^1.0.2" })
    expect(JSON.parse(cf["package.json"]!).dependencies).toEqual({ composurejs: "^1.2.3" })
  })
})

describe("create-composurejs", () => {
  test("writes the template and installs with the package manager that ran it", async () => {
    const t = env()
    expect(await main(["my-bot", "--template", "node"], t.env)).toBe(0)
    expect(JSON.parse(readFileSync(`${tmp}my-bot/package.json`, "utf8")).name).toBe("my-bot")
    expect(existsSync(`${tmp}my-bot/src/node.ts`)).toBe(true)
    expect(t.installs).toHaveLength(1)
    expect(t.installs[0]).toMatch(/^pnpm .*my-bot$/)
  })

  test("defaults without a terminal: my-bot, cloudflare; --no-install skips installing", async () => {
    const t = env()
    expect(await main(["--no-install"], t.env)).toBe(0)
    expect(existsSync(`${tmp}my-bot/wrangler.jsonc`)).toBe(true)
    expect(t.installs).toEqual([])
  })

  test("refuses a non-empty directory without a terminal, and bad names or templates", async () => {
    mkdirSync(`${tmp}taken`, { recursive: true })
    writeFileSync(`${tmp}taken/file.txt`, "x")
    expect(await main(["taken", "--no-install"], env().env)).toBe(1)
    expect(readFileSync(`${tmp}taken/file.txt`, "utf8")).toBe("x")
    const bad = env()
    expect(await main(["x", "--template", "deno"], bad.env)).toBe(1)
    expect(bad.err.join("\n")).toMatch(/argument 'deno' is invalid. Allowed choices are cloudflare, node, bun/)
  })

  test("help and version", async () => {
    const help = env()
    expect(await main(["--help"], help.env)).toBe(0)
    expect(help.out.join("\n")).toMatch(/^Usage: create-composurejs \[options\] \[dir\]/)
    const version = env()
    expect(await main(["--version"], version.env)).toBe(0)
    expect(version.out).toEqual(["0.0.0"])
  })
})
