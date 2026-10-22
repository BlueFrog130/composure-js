import { describe, expect, test } from "vitest"
import { App, Button, command, Ephemeral, type LogEntry, type Logger, Row, Text, UserError } from "composurejs"
import { answer, command as invoke, MockTransport, TestPlatform } from "composurejs/testing"

function recordingLogger() {
  const entries: (LogEntry & { level: string })[] = []
  const at = (level: string) => (entry: LogEntry) => void entries.push({ level, ...entry })
  const logger: Logger = { debug() {}, info: at("info"), warn: at("warn"), error: at("error") }
  return { logger, entries }
}

const ORIGINAL = /^\/webhooks\/1052322265397739523\/test-interaction-token\/messages\/@original$/

describe("c.defer", () => {
  test("answers type 5 now, then edits the original with the work's output", async () => {
    const app = new App().command(command({ name: "slow", description: "S", handler: (c) => c.defer(async () => <Text>done after {1 + 1}s</Text>) }))
    const res = await answer(app, invoke("slow"))
    expect(res.body).toEqual({ type: 5 })
    const [edit] = await res.settle()
    expect(edit).toMatchObject({ method: "PATCH", path: expect.stringMatching(ORIGINAL), json: { flags: 1 << 15, components: [{ type: 10, content: "done after 2s" }] } })
  })

  test("ephemerality is chosen when deferring", async () => {
    const app = new App()
      .command(command({ name: "a", description: "A", handler: (c) => c.defer(() => "x", { ephemeral: true }) }))
      .command(command({ name: "b", description: "B", handler: (c) => Ephemeral(c.defer(() => c.ephemeral("y"))) }))
    expect((await answer(app, invoke("a"))).body).toEqual({ type: 5, data: { flags: 64 } })
    const b = await answer(app, invoke("b"))
    expect(b.body).toEqual({ type: 5, data: { flags: 64 } })
    expect((await b.settle())[0]?.json).toEqual({ content: "y" })
  })

  test("returning Ephemeral from work deferred publicly is an error, shown in the edit", async () => {
    const { logger, entries } = recordingLogger()
    const app = new App({ logger }).command(command({ name: "x", description: "X", handler: (c) => c.defer(() => c.ephemeral("secret")) }))
    const [edit] = await (await answer(app, invoke("x"))).settle()
    expect(edit!.json).toEqual({ content: "Something went wrong." })
    expect((entries.find((e) => e.level === "error")?.error as Error).message).toMatch(/Ephemerality is decided when deferring/)
  })

  test("a failure edits the original with the Error Renderer's output", async () => {
    const { logger } = recordingLogger()
    const app = new App({ logger })
      .command(
        command({
          name: "x",
          description: "X",
          handler: (c) =>
            c.defer(async () => {
              throw new UserError("Out of cookies")
            }),
        }),
      )
      .onError((error) => `⚠️ ${(error as Error).message}`)
    const [edit] = await (await answer(app, invoke("x"))).settle()
    expect(edit).toMatchObject({ method: "PATCH", json: { content: "⚠️ Out of cookies" } })
  })

  test("the edit retries while Discord has not registered the reply (404)", async () => {
    const transport = new MockTransport().reply(404, { code: 10015, message: "Unknown Webhook" }).reply(200, { id: "m" })
    const app = new App({ logger: recordingLogger().logger }).command(command({ name: "x", description: "X", handler: (c) => c.defer(() => "ok") }))
    const res = await answer(app, invoke("x"), { transport })
    await res.settle()
    expect(transport.requests.map((r) => r.method)).toEqual(["PATCH", "PATCH"])
  })

  test("without waitUntil: callback first, work, then 202", async () => {
    const transport = new MockTransport()
    const app = new App().command(command({ name: "x", description: "X", handler: (c) => c.defer(() => "finished") }))
    const res = await answer(app, invoke("x"), { transport, platform: {} })
    expect(res.status).toBe(202)
    expect(transport.requests.map((r) => [r.method, r.path.replace(/\d{6,}/g, "N")])).toEqual([
      ["POST", "/interactions/N/test-interaction-token/callback"],
      ["PATCH", "/webhooks/N/test-interaction-token/messages/@original"],
    ])
    expect(transport.requests[0]!.json).toEqual({ type: 5 })
  })

  test("with a platform waitUntil, the work is handed to it", async () => {
    const platform = new TestPlatform()
    const app = new App().command(command({ name: "x", description: "X", handler: (c) => c.defer(() => "x") }))
    await answer(app, invoke("x"), { platform })
    expect(platform.pending).toBe(1)
  })
})

describe("c.deferUpdate", () => {
  const Refreshable = ({ broken }: { broken: boolean }) => (
    <Row>
      <Button
        onClick={(c) =>
          c.deferUpdate(async () => {
            if (broken) throw new Error("db down")
            return (
              <Row>
                <Button customId="done">Refreshed</Button>
              </Row>
            )
          })
        }
      >
        Refresh
      </Button>
    </Row>
  )
  const app = (logger?: Logger) => new App(logger ? { logger } : {}).command(command({ name: "r", description: "R", handler: (c) => <Refreshable broken={c.locale === "fr"} /> }))

  test("acknowledges with type 6, then edits the component's message", async () => {
    const res = await answer(app(), (await answer(app(), invoke("r"))).click("Refresh"))
    expect(res.body).toEqual({ type: 6 })
    const [edit] = await res.settle()
    expect(edit).toMatchObject({ method: "PATCH", path: expect.stringMatching(ORIGINAL), json: { components: [{ type: 1, components: [{ label: "Refreshed" }] }] } })
  })

  test("a failure goes out as an ephemeral follow-up, leaving the message alone", async () => {
    const quiet = recordingLogger().logger
    const res = await answer(app(quiet), (await answer(app(quiet), invoke("r").locale("fr"))).click("Refresh"))
    const [followup] = await res.settle()
    expect(followup).toMatchObject({ method: "POST", json: { content: "Something went wrong.", flags: 64 } })
    expect(followup!.path).toMatch(/^\/webhooks\/\d+\/test-interaction-token\?wait=true$/)
  })

  test("only answers components, and cannot be ephemeral", async () => {
    const { logger, entries } = recordingLogger()
    const app = new App({ logger })
      .command(command({ name: "x", description: "X", handler: (c) => c.deferUpdate(() => "x") }))
      .command(command({ name: "y", description: "Y", handler: (c) => Ephemeral(c.deferUpdate(() => "x")) }))
    await answer(app, invoke("x"))
    await answer(app, invoke("y"))
    expect(entries.map((e) => (e.error as Error).message)).toEqual([
      "deferUpdate only answers component clicks and modal submits",
      "deferUpdate edits the component's message, which cannot become ephemeral",
    ])
  })
})
