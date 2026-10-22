import { describe, expect, test } from "vitest"
import { transformHandlers } from "../src/transform.ts"

const ROOT = "/bot"
const run = (code: string, file = "/bot/src/counter.tsx") => transformHandlers(code, file, { root: ROOT })?.code
const idsIn = (out: string | undefined) => [...(out ?? "").matchAll(/__composure_handler\("([^"]+)"/g)].map((m) => m[1])

const counter = `
import { Button, Container, Row, Text } from "composurejs"

export const Counter = ({ count, owner }: { count: number; owner: string }) => (
  <Container>
    <Text>## Count: {count}</Text>
    <Row>
      {[1, 5, 10].map((step) => (
        <Button onClick={(c) => (c.user.id === owner ? <Counter count={count + step} owner={owner} /> : c.ephemeral("Not yours"))}>+{step}</Button>
      ))}
      <Button onClick={() => <Counter count={0} owner={owner} />}>Reset</Button>
    </Row>
  </Container>
)
`

describe("transformHandlers", () => {
  test("hoists inline handlers in any component, capturing props and loop variables", () => {
    const out = run(counter)!
    expect(out).toContain(`onClick={__composure_h0.bind([owner, count, step])}`)
    expect(out).toContain(`onClick={__composure_h1.bind([owner])}`)
    expect(out).toMatch(/const __composure_h0 = __composure_handler\("_[\w-]{7}", \["owner","count","step"\], \(\{ owner, count, step \}\) => \(\(c\) => \(c\.user\.id === owner/)
    expect(out).toContain(`import { __handler as __composure_handler } from "composurejs";`)
    // After the imports, before anything that could render at module load.
    expect(out.indexOf("__composure_h0 =")).toBeLessThan(out.indexOf("export const Counter"))
  })

  test("a command handler's c is captured by member chain; a shadowing parameter is not", () => {
    const out = run(`
      import { Button, command } from "composurejs"
      export const ping = command({
        name: "ping",
        description: "Ping",
        handler: (c) => (
          <>
            <Button onClick={(b) => b.ephemeral(\`hi \${c.user.id} in \${c.guildId}\`)}>a</Button>
            <Button onClick={(c) => c.ephemeral(c.user.id)}>b</Button>
          </>
        ),
      })
    `)
    expect(out).toContain(`__composure_h0.bind([c.user.id, c.guildId])`)
    expect(out).toContain(`__composure_h1.bind([])`)
  })

  test("module-scope bindings and imports are not captured; a bare read captures the root", () => {
    const out = run(`
      import { Button, Row } from "composurejs"
      import { db } from "./db"
      const PREFIX = ">"
      export function List({ items }: { items: string[] }) {
        const first = items[0]
        return <Row><Button onClick={() => db.save(PREFIX + first + items.length)}>save</Button></Row>
      }
    `)
    expect(out).toContain(`__composure_h0.bind([first, items.length])`)
  })

  test("named() gives a stable id of your choosing", () => {
    const out = run(`
      import { Button, named } from "composurejs"
      export const Roles = ({ role }: { role: string }) => <Button onClick={named("toggle-role", (c) => toggle(c, role))}>Toggle</Button>
    `)
    expect(out).toContain(`onClick={__composure_h0.bind([role])}`)
    expect(out).toContain(`__composure_handler("toggle-role", ["role"], ({ role }) => ((c) => toggle(c, role)), "src/counter.tsx: Roles")`)
  })

  test("a handler returning markup with handlers hoists both, the inner rewritten inside the outer", () => {
    const out = run(`
      import { Button } from "composurejs"
      export const Menu = ({ user }: { user: string }) => (
        <Button onClick={() => <Button onClick={(c) => c.ephemeral(user)}>Confirm</Button>}>Delete</Button>
      )
    `)!
    expect(out).toContain(`onClick={__composure_h0.bind([user])}`)
    expect(out).toMatch(
      /const __composure_h0 = __composure_handler\("_[\w-]{7}", \["user"\], \(\{ user \}\) => \(\(\) => <Button onClick=\{__composure_h1\.bind\(\[user\]\)\}>Confirm<\/Button>\), "src\/counter\.tsx: Menu"\);/,
    )
    expect(out).toMatch(/const __composure_h1 = __composure_handler\("_[\w-]{7}", \["user"\], \(\{ user \}\) => \(\(c\) => c\.ephemeral\(user\)\), "src\/counter\.tsx: Menu"\);/)
  })

  test("generated ids survive unrelated edits, and change with file, owner, position or captures", () => {
    const [a, b] = idsIn(run(counter))
    expect(a).not.toBe(b)
    expect(idsIn(run(`// a comment\nconst unrelated = 1\n${counter.replace("## Count", "### Total")}`))).toEqual([a, b])
    expect(idsIn(run(counter, "/bot/src/other.tsx"))[0]).not.toBe(a)
    expect(idsIn(run(counter.replace(/Counter/g, "Tally")))[0]).not.toBe(a)
    // Editing a handler's body keeps its id; capturing something new changes it.
    expect(idsIn(run(counter.replace("<Counter count={0} owner={owner} />", "<Counter count={count * 0} owner={owner} />")))[1]).not.toBe(b)
    expect(idsIn(run(counter.replace('c.ephemeral("Not yours")', 'c.ephemeral("Hands off")')))[0]).toBe(a)
    expect(idsIn(run(counter.replace("c.user.id === owner ?", "c.user.id === owner && count < 100 ?")))[0]).toBe(a)
    expect(idsIn(run(counter.replace('c.ephemeral("Not yours")', "c.ephemeral(String(count))")))[0]).toBe(a)
    expect(idsIn(run(counter.replace("+{step}</Button>", "+{step}</Button>").replace("(c) => (c.user.id === owner", "(c) => (c.user.id === owner && STEP_LIMIT")))[0]).toBe(a)
  })

  test("a handler may not render a component defined inside a function", () => {
    expect(() =>
      run(`import { Button } from "composurejs"\nexport function make() { const Local = () => <Button>x</Button>; return <Button onClick={() => <Local />}>go</Button> }`),
    ).toThrow("<Local> is defined inside a function, but the onClick handler rendering it is hoisted to module scope: define Local at module scope")
    expect(
      run(`import { Button } from "composurejs"\nconst Top = () => <Button>x</Button>\nexport function make() { return <Button onClick={() => <Top />}>go</Button> }`),
    ).toContain("__composure_h0.bind([])")
  })

  test("errors point at the handler", () => {
    expect(() => run(`import { Button } from "composurejs"\nexport const V = () => { const go = () => 1; return <Button onClick={go} /> }`)).toThrow(
      "onClick={go}: write the handler inline, so it can be hoisted with what it captures",
    )
    expect(() => run(`import { Button, named } from "composurejs"\nconst id = "x"\nexport const V = () => <Button onClick={named(id, () => 1)} />`)).toThrow(
      "named() needs a string literal id",
    )
    expect(() => run(`import { Button, named } from "composurejs"\nexport const V = () => <Button onClick={named("_x", () => 1)} />`)).toThrow('not starting with "_"')
    expect(() =>
      run(`import { Button, named } from "composurejs"\nexport const V = () => <><Button onClick={named("a", () => 1)} /><Button onClick={named("a", () => 2)} /></>`),
    ).toThrow('named("a") is used twice in this module')
  })

  test("leaves references and modules without handlers alone", () => {
    expect(run(`import { Button } from "composurejs"\nimport { refresh } from "./refs"\nexport const V = () => <Button onClick={refresh} />`)).toBeUndefined()
    expect(run(`export const x = 1`)).toBeUndefined()
  })

  test("emits a source map", () => {
    expect(transformHandlers(counter, "/bot/src/counter.tsx", { root: ROOT })?.map.mappings.length).toBeGreaterThan(0)
  })
})
