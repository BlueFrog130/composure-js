import { afterEach, describe, expect, test, vi } from "vitest"
import { App, Button, command, createLogger, type LogEntry, type Logger, Row, withFields } from "composurejs"
import { createMessage } from "composurejs/rest"
import * as t from "composurejs/testing"

afterEach(() => vi.restoreAllMocks())

const Counter = ({ n }: { n: number }) => (
  <Row>
    <Button
      onClick={(c) => {
        c.log.warn({ msg: "clicked" })
        return <Counter n={n + 1} />
      }}
    >
      {String(n)}
    </Button>
  </Row>
)

const spy = (level: "debug" | "info" | "warn" | "error") => vi.spyOn(console, level).mockImplementation(() => {})

describe("createLogger", () => {
  test("writes info and above by default; level filters", () => {
    const debug = spy("debug")
    const info = spy("info")
    createLogger({ format: "object" }).debug({ msg: "hidden" })
    createLogger({ format: "object" }).info({ msg: "shown", n: 1 })
    createLogger({ format: "object", level: "debug" }).debug({ msg: "shown too" })
    createLogger({ format: "object", level: "silent" }).info({ msg: "hidden" })
    expect(debug.mock.calls).toEqual([[{ msg: "shown too" }]])
    expect(info.mock.calls).toEqual([[{ msg: "shown", n: 1 }]])
  })

  test("child loggers add fields; the entry's own win", () => {
    const info = spy("info")
    createLogger({ format: "object", fields: { app: "a" } }).child!({ interactionId: "1" }).child!({ command: "x" }).info({ msg: "m", command: "y" })
    expect(info.mock.calls).toEqual([[{ app: "a", interactionId: "1", command: "y", msg: "m" }]])
  })

  test("json: one line with time and level; Errors serialized, bigints as strings", () => {
    const error = spy("error")
    createLogger({ format: "json" }).error({ msg: "failed", error: new Error("boom", { cause: new Error("root") }), big: 1n })
    const line = JSON.parse(error.mock.calls[0]![0] as string) as Record<string, unknown>
    expect(line).toMatchObject({ level: "error", msg: "failed", big: "1", error: { name: "Error", message: "boom", cause: { message: "root" } } })
    expect(typeof line.time).toBe("string")
  })

  test("pretty: level, message and fields on one line, then stacks with their causes", () => {
    const warn = spy("warn")
    createLogger({ format: "pretty" }).warn({ msg: "Rate limited", route: "POST /x", retryAfter: 2, note: "two words", error: new Error("boom", { cause: new Error("root") }) })
    const [first, ...rest] = (warn.mock.calls[0]![0] as string).split("\n")
    expect(first).toBe('WARN  Rate limited route="POST /x" retryAfter=2 note="two words"')
    expect(rest[0]).toBe("Error: boom")
    expect(rest.some((l) => l.startsWith("Caused by: Error: root"))).toBe(true)
  })

  test("never throws: a field JSON cannot hold is logged as the object", () => {
    const info = spy("info")
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => createLogger({ format: "json" }).info({ msg: "m", cyclic })).not.toThrow()
    expect(info.mock.calls[0]![0]).toMatchObject({ msg: "m" })
  })
})

describe("withFields", () => {
  test("wraps a logger without child, calling its methods on it", () => {
    const seen: LogEntry[] = []
    const base = {
      seen,
      debug() {},
      info(this: { seen: LogEntry[] }, entry: LogEntry) {
        this.seen.push(entry)
      },
      warn() {},
      error() {},
    }
    withFields(base, { a: 1 }).child!({ b: 2 }).info({ msg: "m" })
    expect(seen).toEqual([{ a: 1, b: 2, msg: "m" }])
  })

  test("uses the logger's own child (pino's)", () => {
    const child = vi.fn((fields: Record<string, unknown>): Logger => ({ ...createLogger(), fields }) as Logger)
    withFields({ ...createLogger(), child }, { a: 1 })
    expect(child).toHaveBeenCalledWith({ a: 1 })
  })
})

describe("in the pipeline", () => {
  test("entries carry the Interaction's fields, REST calls and c.log included", async () => {
    const logs = t.recordLogs()
    const app = new App({ logger: logs.logger }).command(
      command({
        name: "post",
        description: "P",
        handler: async (c) => {
          c.log.info({ msg: "posting" })
          await createMessage(c.bot, "1", "hi")
          return "done"
        },
      }),
    )
    await t.answer(app, t.chatInput("post"), { transport: new t.MockTransport().reply(200, { id: "m" }) })
    const fields = { interactionType: 2, command: "post", guildId: t.TEST_GUILD_ID, userId: t.testUser.id }
    expect(logs.entries.find((e) => e.msg === "posting")).toMatchObject({ level: "info", ...fields })
    expect(logs.entries.find((e) => e.msg === "REST response")).toMatchObject({ level: "debug", route: "POST /channels/{channel_id}/messages", ...fields })
    expect(logs.entries.every((e) => typeof e.interactionId === "string")).toBe(true)
  })

  test("a click's entries name its handler, never its Custom ID State", async () => {
    const logs = t.recordLogs()
    const app = new App({ logger: logs.logger }).command(command({ name: "count", description: "C", handler: () => <Counter n={41} /> }))
    await t.answer(app, (await t.answer(app, t.chatInput("count"))).click("41"))
    const clicked = logs.entries.find((e) => e.msg === "clicked")!
    expect(clicked).toMatchObject({ interactionType: 3 })
    expect(clicked.handler).toMatch(/^[^:]+$/)
    expect(JSON.stringify(clicked)).not.toContain("n15")
  })

  test("Webhook Events log with their type", async () => {
    const logs = t.recordLogs()
    const app = new App({ logger: logs.logger }).events((c) => c.log.info({ msg: "event" }))
    await t.sendEvent(app, t.webhookEvent("APPLICATION_AUTHORIZED", { user: t.testUser }))
    expect(logs.entries).toContainEqual(expect.objectContaining({ msg: "event", event: "APPLICATION_AUTHORIZED" }))
  })

  test("App takes options for the built-in logger", async () => {
    const debug = spy("debug")
    spy("info")
    await t.answer(
      new App({ logger: { level: "debug", format: "object" } }).command(command({ name: "x", description: "X", handler: (c) => (c.log.debug({ msg: "here" }), "ok") })),
      t.chatInput("x"),
    )
    expect(debug).toHaveBeenCalledWith(expect.objectContaining({ msg: "here", command: "x" }))
  })
})
