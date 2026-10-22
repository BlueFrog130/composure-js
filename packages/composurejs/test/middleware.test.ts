import { describe, expect, test } from "vitest"
import { App, command, Ephemeral, type LogEntry, type Logger, middleware, UserError } from "composurejs"
import * as t from "composurejs/testing"

const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} }
const echo = command({ name: "echo", description: "Echo", handler: (c) => `echo ${String(c.var.trace ?? "")}`.trim() })

describe("middleware", () => {
  test("runs in onion order around the Route; nested Apps' run inside", async () => {
    const order: string[] = []
    const trace = (name: string) =>
      middleware(async (_c, next) => {
        order.push(`${name}>`)
        const out = await next()
        order.push(`<${name}`)
        return out
      })
    const inner = new App().use(trace("inner")).command(echo)
    const app = new App().route(inner).use(trace("a"), trace("b"))
    expect((await t.answer(app, t.command("echo"))).text).toBe("echo")
    expect(order).toEqual(["a>", "b>", "inner>", "<inner", "<b", "<a"])
  })

  test("returning an Output short-circuits; returning nothing passes next's on", async () => {
    let ran = false
    const guildOnly = middleware((c, next) => (c.guildId ? next() : Ephemeral("Servers only.")))
    const passive = middleware(async (_c, next) => {
      await next()
    })
    const app = new App()
      .use(guildOnly, passive)
      .command(command({ name: "x", description: "X", handler: () => ((ran = true), "ran") }))
    const dm = await t.answer(app, t.command("x").inDm())
    expect([dm.text, dm.isEphemeral, ran]).toEqual(["Servers only.", true, false])
    expect((await t.answer(app, t.command("x"))).text).toBe("ran")
  })

  test("can replace the inner Output", async () => {
    const shout = middleware(async (_c, next) => {
      const out = await next()
      return typeof out === "string" ? out.toUpperCase() : out
    })
    expect((await t.answer(new App().use(shout).command(echo), t.command("echo"))).text).toBe("ECHO")
  })

  test("Variables set in middleware reach the handler", async () => {
    type E = { Variables: { trace: string } }
    const app = new App<E>()
      .use((c, next) => {
        c.set("trace", "abc")
        return next()
      })
      .command(command<{}, E>({ name: "echo", description: "Echo", handler: (c) => `echo ${c.var.trace} ${c.get("trace")}` }))
    expect((await t.answer(app, t.command("echo"))).text).toBe("echo abc abc")
  })

  test("only the root's middleware sees Interactions no Route answers", async () => {
    const kinds: number[] = []
    const seen = middleware((c, next) => (kinds.push(c.interaction.type), next()))
    const app = new App({ logger: quiet }).use(seen).route(new App().use(() => "never").command(echo))
    await t.answer(app, t.component("gone:click"))
    await t.answer(app, t.command("unknown"))
    await t.answer(app, t.autocomplete("unknown").focused("q", ""))
    expect(kinds).toEqual([3, 2, 4])
  })

  test("errors thrown in middleware go to the Error Renderer", async () => {
    const entries: LogEntry[] = []
    const app = new App({ logger: { ...quiet, debug: (e) => void entries.push(e) } })
      .use(() => {
        throw new UserError("Slow down.")
      })
      .command(echo)
      .onError((error) => `⚠️ ${(error as Error).message}`)
    const res = await t.answer(app, t.command("echo"))
    expect([res.text, res.isEphemeral]).toEqual(["⚠️ Slow down.", true])
    expect(entries).toHaveLength(1)
  })

  test("returning nothing without calling next, or calling it twice, is an error", async () => {
    const silent = new App({ logger: quiet }).use(() => {}).command(echo)
    expect((await t.answer(silent, t.command("echo"))).text).toBe("Something went wrong.")
    const twice = new App({ logger: quiet })
      .use(async (_c, next) => {
        await next()
        return next()
      })
      .command(echo)
    expect((await t.answer(twice, t.command("echo"))).text).toBe("Something went wrong.")
  })
})
