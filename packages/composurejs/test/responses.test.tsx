import { describe, expect, test } from "vitest"
import { App, command, Ephemeral, File, Label, type LogEntry, type Logger, Modal, Text, TextInput, Update, upload } from "composurejs"
import { answer, command as invoke, component, MockTransport } from "composurejs/testing"

function recordingLogger() {
  const entries: (LogEntry & { level: string })[] = []
  const at = (level: string) => (entry: LogEntry) => void entries.push({ level, ...entry })
  const logger: Logger = { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") }
  return { logger, entries }
}

const report = (
  <Modal title="Report" customId="report">
    <Label text="What happened?">
      <TextInput name="what" />
    </Label>
  </Modal>
)

describe("responses", () => {
  test("a <Modal> View opens a modal", async () => {
    const app = new App().command(command({ name: "report", description: "Report", handler: () => report }))
    const res = await answer(app, invoke("report"))
    expect(res.type).toBe(9)
    expect(res.data).toMatchObject({ custom_id: "report", title: "Report" })
    expect(res.component("what")).toMatchObject({ type: 4, style: 1 })
  })

  test("Update replaces the component's message (type 7), only for components", async () => {
    // Middleware is the only way to answer a component until Component Handlers land.
    const { logger } = recordingLogger()
    const app = new App({ logger }).use((c, next) => (c.interaction.type === 3 ? Update(<Text>updated</Text>) : next()))
    const res = await answer(app, component("card:like"))
    expect(res.type).toBe(7)
    expect(res.text).toBe("updated")

    const wrong = new App({ logger }).command(command({ name: "x", description: "X", handler: () => Update("nope") }))
    expect((await answer(wrong, invoke("x"))).text).toBe("Something went wrong.")
  })

  test("wrapping rules: Ephemeral needs a new message, Update cannot be ephemeral", async () => {
    const { logger, entries } = recordingLogger()
    const app = new App({ logger })
      .command(command({ name: "a", description: "A", handler: () => Ephemeral(report) }))
      .use((c, next) => (c.interaction.type === 3 ? Update(Ephemeral("x")) : next()))
    await answer(app, invoke("a"))
    await answer(app, component("x"))
    expect(entries.map((e) => (e.error as Error).message)).toEqual([
      "Ephemeral only applies to new messages, not to Update, modals or deferrals",
      "Update cannot change whether a message is ephemeral",
    ])
  })

  test("a raw Components V2 response with content is rejected", async () => {
    const { logger, entries } = recordingLogger()
    const app = new App({ logger }).command(command({ name: "raw", description: "Raw", handler: () => ({ type: 4, data: { flags: 1 << 15, content: "x" } }) }))
    expect((await answer(app, invoke("raw"))).text).toBe("Something went wrong.")
    expect((entries[0]?.error as Error).message).toMatch(/cannot carry content or embeds/)
  })
})

describe("files", () => {
  const app = (logger?: Logger) =>
    new App(logger ? { logger } : {}).command(
      command({
        name: "export",
        description: "Export",
        handler: () => (
          <>
            <Text>Your export</Text>
            <File src={upload("export.csv", "a,b\n1,2", { contentType: "text/csv", description: "Data" })} />
          </>
        ),
      }),
    )

  test("go multipart through the callback endpoint, answered with 202", async () => {
    const transport = new MockTransport().reply(204)
    const res = await answer(app(), invoke("export"), { transport })
    expect(res.status).toBe(202)
    expect(transport.requests).toHaveLength(1)
    const [request] = transport.requests
    expect(request!.method).toBe("POST")
    expect(request!.path).toMatch(/^\/interactions\/\d+\/test-interaction-token\/callback$/)
    expect(request!.json).toMatchObject({ type: 4, data: { attachments: [{ id: 0, filename: "export.csv", description: "Data" }] } })
    expect(res.text).toBe("Your export")
    expect(res.files).toHaveLength(1)
    expect(res.files[0]).toMatchObject({ field: "files[0]", name: "export.csv", type: "text/csv" })
    expect(new TextDecoder().decode(res.files[0]!.bytes)).toBe("a,b\n1,2")
  })

  test("if Discord rejects the callback, the HTTP response carries the error; the token is never logged", async () => {
    const { logger, entries } = recordingLogger()
    const transport = new MockTransport().reply(400, { message: "Invalid Form Body" })
    const res = await answer(app(logger), invoke("export"), { transport })
    expect(res.status).toBe(200)
    expect([res.text, res.isEphemeral]).toEqual(["Something went wrong.", true])
    expect(entries.find((e) => e.level === "error")).toMatchObject({ level: "error", msg: "Answering through the callback endpoint failed", status: 400, route: "POST /interactions/{interaction_id}/{interaction_token}/callback" })
    expect(JSON.stringify(entries)).not.toContain("test-interaction-token")
  })
})
