import { describe, expect, test } from "vitest"
import { transformViews } from "../src/transform.ts"

const run = (code: string) => transformViews(code, "card.tsx")?.code

describe("transformViews", () => {
  test("hoists a handler, capturing only the Props it reads", () => {
    const out = run(`
      import { view, p } from "composurejs"
      export const Card = view("card", {
        props: { title: p.string(), likes: p.int(), color: p.int() },
        render: ({ title, likes, color }, on) => (
          <Button onClick={on("like", () => Card({ title, likes: likes + 1, color }))}>Like {likes}</Button>
        ),
      })
    `)
    expect(out).toContain(`onClick={on.$("like", [])}`)
    expect(out).toContain(
      `, handlers: { "like": { props: [["title","title"],["likes","likes"],["color","color"]], locals: [], make: ({ title, likes, color }) => (() => Card({ title, likes: likes + 1, color })) } }`,
    )
  })

  test("renamed and defaulted Props map to their keys; module bindings are not captured", () => {
    const out = run(`
      import { view as v } from "composurejs"
      const BRAND = 1
      export const C = v("c", {
        render: ({ likes: l = 0, title }, on) => <Button onClick={on("x", (c) => c.ephemeral(BRAND + l))} />,
      })
    `)
    expect(out).toContain(`"x": { props: [["l","likes"]], locals: [], make: ({ l }) => ((c) => c.ephemeral(BRAND + l)) }`)
  })

  test("loop variables are captured as member chains; method calls stop the chain", () => {
    const out = run(`
      import { view } from "composurejs"
      export const Todo = view("todo", {
        props: { list: p.string() },
        render: async ({ list }, on) => {
          const items = await load(list)
          return items.map((item) => (
            <Button onClick={on("remove", () => remove(list, item.id, item.name.toUpperCase(), item.meta.tag))}>x</Button>
          ))
        },
      })
    `)
    expect(out).toContain(`on.$("remove", [item.id, item.name, item.meta.tag])`)
    expect(out).toContain(`"remove": { props: [["list","list"]], locals: ["item.id","item.name","item.meta.tag"], make: ({ list, item }) =>`)
  })

  test("a bare read of a local captures it whole, covering its chains", () => {
    const out = run(`
      import { view } from "composurejs"
      export const V = view("v", { render: (_, on) => { const n = 1; return <Button onClick={on("a", () => f(n, n.toFixed))} /> } })
    `)
    expect(out).toContain(`on.$("a", [n])`)
    expect(out).toContain(`locals: ["n"]`)
  })

  test("a props identifier: props.x captures x by path; bare props captures all", () => {
    const out = run(`
      import { view } from "composurejs"
      export const V = view("v", {
        render: (props, on) => (
          <>
            <Button onClick={on("one", () => props.title)} />
            <Button onClick={on("all", () => V(props))} />
          </>
        ),
      })
    `)
    expect(out).toContain(`"one": { props: [["props.title","title"]], locals: [], make: ({ props }) => (() => props.title) }`)
    expect(out).toContain(`"all": { props: [["props","*"]], locals: [], make: ({ props }) => (() => V(props)) }`)
  })

  test("handler parameters and closure-local bindings are not captures", () => {
    const out = run(`
      import { view } from "composurejs"
      export const V = view("v", {
        render: (_, on) => <StringSelect onSelect={on("pick", (c, values) => { const first = values[0]; return first })} />,
      })
    `)
    expect(out).toContain(`"pick": { props: [], locals: [], make: (_) => ((c, values) => { const first = values[0]; return first }) }`)
  })

  test("methods (render() {}) and namespace imports work", () => {
    const out = run(`
      import * as cj from "composurejs"
      export const V = cj.view("v", {
        props: { n: cj.p.int() },
        render({ n }, on) { return <Button onClick={on("inc", () => V({ n: n + 1 }))} /> },
      })
    `)
    expect(out).toContain(`on.$("inc", [])`)
    expect(out).toContain(`"inc": { props: [["n","n"]]`)
  })

  test("leaves modules without composurejs Views alone", () => {
    expect(run(`import { view } from "elsewhere"; view("x", { render: (_, on) => on("a", () => 1) })`)).toBeUndefined()
    expect(run(`import { view } from "composurejs"; export const V = view("x", { render: () => null })`)).toBeUndefined()
  })

  test("errors point at the problem", () => {
    const base = (body: string) => `import { view } from "composurejs"\nexport const V = view("v", { render: (_, on) => ${body} })`
    expect(() => run(base(`on(name, () => 1)`))).toThrow("on() needs a string literal handler name")
    expect(() => run(base(`on("a", handler)`))).toThrow('on("a", ..) needs the handler written inline')
    expect(() => run(base(`[on("a", () => 1), on("a", () => 2)]`))).toThrow('Handler name "a" is used twice in one View')
    expect(() => run(base(`on("a", () => on("b", () => 1))`))).toThrow("on() cannot be called inside a handler")
    expect(() => run(`import { view } from "composurejs"\nview("v", { render: (_, on) => on("a", () => 1), handlers: {} })`)).toThrow("remove the handlers property")
  })

  test("a shadowed on is left alone", () => {
    const out = run(`
      import { view } from "composurejs"
      export const V = view("v", { render: (_, on) => [on("a", () => 1), [1].map((on) => on("b", () => 2))] })
    `)
    expect(out).toContain(`on.$("a", [])`)
    expect(out).toContain(`(on) => on("b", () => 2)`)
  })

  test("emits a source map", () => {
    const result = transformViews(`import { view } from "composurejs"\nexport const V = view("v", { render: (_, on) => on("a", () => 1) })`, "v.tsx")
    expect(result?.map.mappings.length).toBeGreaterThan(0)
  })
})
