// The Handler Lock (ADR 0029) over real `vite build`s of a throwaway project.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, test } from "vitest"
import { build, createLogger } from "vite"
import composure, { LOCK_FILE } from "../src/index.ts"
import { diffLock } from "../src/lock.ts"

let dir: string

const source = (extra = "", poll = "c.user.id") => `
import { App, Button, command, named, Row } from "composurejs"
export const Menu = ({ owner }: { owner: string }) => (
  <Row>
    <Button onClick={(c) => c.reply(owner)}>Who</Button>
    ${extra}
    <Button onClick={named("poll-yes", (c) => c.reply(${poll}))}>Yes</Button>
  </Row>
)
export const app = new App().command(command({ name: "menu", description: "M", handler: (c) => <Menu owner={c.user.id} /> }))
`

function project(code: string): void {
  dir = fileURLToPath(new URL(`./.tmp/${Math.random().toString(36).slice(2)}/`, import.meta.url))
  mkdirSync(`${dir}src`, { recursive: true })
  writeFileSync(`${dir}package.json`, JSON.stringify({ type: "module" }))
  writeFileSync(`${dir}tsconfig.json`, JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "composurejs" } }))
  writeFileSync(`${dir}src/app.tsx`, code)
}

async function vite(options: { ci?: boolean; handlerLock?: boolean } = {}): Promise<string[]> {
  const warnings: string[] = []
  const logger = createLogger("warn")
  logger.warn = (msg) => void warnings.push(msg)
  const ci = process.env.CI
  if (options.ci) process.env.CI = "true"
  else delete process.env.CI
  try {
    await build({
      root: dir,
      configFile: false,
      customLogger: logger,
      logLevel: "warn",
      plugins: [composure({ placement: false, ...(options.handlerLock === false && { handlerLock: false }) })],
      build: { ssr: "src/app.tsx", write: false },
    })
  } finally {
    if (ci === undefined) delete process.env.CI
    else process.env.CI = ci
  }
  return warnings
}

const lock = () => JSON.parse(readFileSync(`${dir}${LOCK_FILE}`, "utf8")) as Record<string, { where: string; captures: string[] }>

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("Handler Lock", () => {
  test("the first build writes every handler id with where it is and what it captures", async () => {
    project(source())
    await vite()
    const ids = lock()
    expect(Object.values(ids)).toEqual(
      expect.arrayContaining([
        { where: "src/app.tsx: Menu", captures: ["owner"] },
        { where: "src/app.tsx: Menu", captures: [] },
      ]),
    )
    expect(ids["poll-yes"]).toEqual({ where: "src/app.tsx: Menu", captures: [] })
    expect(Object.keys(ids)).toHaveLength(2)
  })

  test("a local build that drops an id warns and updates the lock; CI fails instead and writes nothing", async () => {
    project(source(`<Button onClick={() => "extra"}>Extra</Button>`))
    await vite()
    const before = lock()
    writeFileSync(`${dir}src/app.tsx`, source())

    await expect(vite({ ci: true })).rejects.toThrow(/Buttons already sent would answer "This message is outdated."[\s\S]*no longer in the code/)
    expect(lock()).toEqual(before)

    const warnings = await vite()
    expect(warnings.join("\n")).toMatch(/will answer "This message is outdated."[\s\S]*src\/app\.tsx: Menu\): no longer in the code/)
    expect(Object.keys(lock())).toHaveLength(2)
    await expect(vite({ ci: true })).resolves.toBeDefined()
  })

  test("a named() handler capturing something new breaks old buttons too", async () => {
    project(source())
    await vite()
    writeFileSync(`${dir}src/app.tsx`, source("", "owner"))
    await expect(vite({ ci: true })).rejects.toThrow("poll-yes (src/app.tsx: Menu): captures [owner], was []")
  })

  test("new handlers pass in CI with a warning; handlerLock: false turns it off", async () => {
    project(source())
    await vite()
    writeFileSync(`${dir}src/app.tsx`, source(`<Button onClick={() => "extra"}>Extra</Button>`))
    expect((await vite({ ci: true })).join("\n")).toMatch(`${LOCK_FILE} is missing 1 new handler`)

    rmSync(`${dir}${LOCK_FILE}`)
    await vite({ handlerLock: false })
    expect(existsSync(`${dir}${LOCK_FILE}`)).toBe(false)
  })

  test("diffLock compares by id and captures", () => {
    const a = { x: { where: "f: A", captures: ["n"] }, y: { where: "f: A", captures: [] } }
    expect(diffLock(a, { x: { where: "g: B", captures: ["n"] }, z: { where: "f: A", captures: [] } })).toEqual({ removed: ["y"], changed: [], added: ["z"] })
    expect(diffLock(a, { x: { where: "f: A", captures: ["m"] }, y: a.y })).toEqual({ removed: [], changed: ["x"], added: [] })
  })
})
