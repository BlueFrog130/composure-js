import { describe, expect, test, vi } from "vitest"
import { App, AppConfigError, command, Ephemeral, type LogEntry, type Logger, Text, UserError } from "composurejs"
import { answer, command as invoke, TestKey, TestPlatform } from "composurejs/testing"

function recordingLogger() {
  const entries: (LogEntry & { level: string })[] = []
  const at = (level: string) => (entry: LogEntry) => void entries.push({ level, ...entry })
  const logger: Logger = { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") }
  return { logger, entries }
}

const ping = command({ name: "ping", description: "Pong", handler: () => "pong" })

describe("answering", () => {
  test("a string answers as a message", async () => {
    const res = await answer(new App().command(ping), invoke("ping"))
    expect(res.status).toBe(200)
    expect(res.type).toBe(4)
    expect(res.text).toBe("pong")
    expect(res.isEphemeral).toBe(false)
  })

  test("a View answers as a Components V2 message", async () => {
    const app = new App().command(command({ name: "hi", description: "Hi", handler: (c) => <Text>Hi {c.user.username}</Text> }))
    const res = await answer(app, invoke("hi"))
    expect(res.flags & (1 << 15)).not.toBe(0)
    expect(res.components).toEqual([{ type: 10, content: "Hi alice" }])
  })

  test("Ephemeral and c.ephemeral set the flag", async () => {
    const app = new App()
      .command(command({ name: "a", description: "A", handler: () => Ephemeral("a") }))
      .command(command({ name: "b", description: "B", handler: (c) => c.ephemeral(<Text>b</Text>) }))
    expect((await answer(app, invoke("a"))).isEphemeral).toBe(true)
    const b = await answer(app, invoke("b"))
    expect(b.isEphemeral).toBe(true)
    expect(b.text).toBe("b")
  })

  test("async handlers and a raw InteractionResponse pass through", async () => {
    const app = new App().command(command({ name: "raw", description: "Raw", handler: async () => ({ type: 5 }) }))
    expect((await answer(app, invoke("raw"))).body).toEqual({ type: 5 })
  })

  test("context exposes user, guild, channel, locale", async () => {
    let seen: unknown
    const app = new App().command(
      command({ name: "ctx", description: "Ctx", handler: (c) => ((seen = { user: c.user.id, guild: c.guildId, channel: c.channelId, locale: c.locale, member: !!c.member }), "ok") }),
    )
    await answer(app, invoke("ctx").by({ id: "42" }).locale("fr"))
    expect(seen).toEqual({ user: "42", guild: "798662131062931547", channel: "300000000000000001", locale: "fr", member: true })
    await answer(app, invoke("ctx").inDm())
    expect(seen).toMatchObject({ guild: undefined, member: false })
  })

  test("c.waitUntil hands Background Work to the Platform", async () => {
    const platform = new TestPlatform()
    let ran = false
    const app = new App().command(command({ name: "bg", description: "Bg", handler: (c) => (c.waitUntil(Promise.resolve().then(() => void (ran = true))), "ok") }))
    await answer(app, invoke("bg"), { platform })
    expect(platform.pending).toBe(1)
    await platform.runBackground()
    expect(ran).toBe(true)
  })
})

describe("errors", () => {
  test("a User Error is shown as written, ephemeral, logged at debug", async () => {
    const { logger, entries } = recordingLogger()
    const app = new App({ logger }).command(command({ name: "x", description: "X", handler: () => { throw new UserError("Nope") } }))
    const res = await answer(app, invoke("x"))
    expect(res.text).toBe("Nope")
    expect(res.isEphemeral).toBe(true)
    expect(entries.map((e) => e.level)).toEqual(["debug"])
  })

  test("other errors are logged with their cause chain and shown generically", async () => {
    const { logger, entries } = recordingLogger()
    const app = new App({ logger }).command(
      command({ name: "x", description: "X", handler: () => { throw new Error("outer", { cause: new Error("inner") }) } }),
    )
    const res = await answer(app, invoke("x"))
    expect(res.text).toBe("Something went wrong.")
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ level: "error", command: "x", error: { message: "outer", cause: { message: "inner" } } })
    expect(JSON.stringify(entries)).not.toContain("test-interaction-token")
  })

  test("onError renders errors, ephemeral, wherever it is in the tree", async () => {
    const inner = new App().command(command({ name: "x", description: "X", handler: () => { throw new Error("boom") } }))
    inner.onError((error) => <Text>Oops: {(error as Error).message}</Text>)
    const res = await answer(new App({ logger: recordingLogger().logger }).route(inner), invoke("x"))
    expect(res.isEphemeral).toBe(true)
    expect(res.text).toBe("Oops: boom")
  })

  test("a failing Error Renderer falls back to the default message", async () => {
    const app = new App({ logger: recordingLogger().logger })
      .command(command({ name: "x", description: "X", handler: () => { throw new UserError("Nope") } }))
      .onError(() => { throw new Error("renderer") })
    expect((await answer(app, invoke("x"))).text).toBe("Nope")
  })

  test("returning nothing is an error", async () => {
    const app = new App({ logger: recordingLogger().logger }).command(command({ name: "x", description: "X", handler: () => undefined as never }))
    expect((await answer(app, invoke("x"))).text).toBe("Something went wrong.")
  })
})

describe("App tree", () => {
  test("nested Apps dispatch their Commands", async () => {
    const app = new App().route(new App().route(new App().command(ping)))
    expect((await answer(app, invoke("ping"))).text).toBe("pong")
  })

  test("a Command listed twice is rejected with both paths", () => {
    const app = new App().command(ping).route(new App().command(command({ name: "ping", description: "Again", handler: () => "x" })))
    expect(() => app.check()).toThrow(AppConfigError)
    expect(() => app.check()).toThrow('Command "/ping" is listed twice: at app.route[0] and at app.route[1].route[0]')
  })

  test("onError twice in a tree is rejected", () => {
    const app = new App().onError(() => "a").route(new App().onError(() => "b"))
    expect(() => app.check()).toThrow("onError is set twice in one App tree: at app and at app.route[0]")
  })

  test("cycles are rejected", () => {
    const a = new App()
    const b = new App().route(a)
    a.route(b)
    expect(() => a.check()).toThrow("cycle")
  })

  test("invalid Command names and descriptions throw at definition", () => {
    expect(() => command({ name: "Ping", description: "x", handler: () => "x" })).toThrow(AppConfigError)
    expect(() => command({ name: "ping", description: "", handler: () => "x" })).toThrow("description must be 1-100 characters")
  })
})

describe("credentials and Bot Data", () => {
  test("loaders run once per isolate; failures answer 500 and are retried", async () => {
    const key = await TestKey.generate()
    const { logger, entries } = recordingLogger()
    const credentials = vi.fn().mockRejectedValueOnce(new Error("secret store down")).mockResolvedValue({ publicKey: key.publicKey })
    const data = vi.fn(async (env: { GREETING: string }) => ({ greeting: env.GREETING }))
    const app = new App<{ Bindings: { GREETING: string }; Data: { greeting: string } }>({ credentials, data, logger }).command(
      command({ name: "greet", description: "Greet", handler: (c) => c.data.greeting }),
    )
    const body = JSON.stringify(invoke("greet").build())
    const env = { GREETING: "hello" }

    expect((await app.fetch(await key.request(body), env)).status).toBe(500)
    expect(entries[0]?.msg).toMatch(/Loading Credentials or Bot Data failed/)
    for (let i = 0; i < 2; i++) {
      const res = await app.fetch(await key.request(body), env)
      expect(await res.json()).toEqual({ type: 4, data: { content: "hello" } })
    }
    expect(credentials).toHaveBeenCalledTimes(2)
    expect(data).toHaveBeenCalledTimes(1)
  })

  test("by default Credentials come from DISCORD_* in the env", async () => {
    const key = await TestKey.generate()
    const app = new App().command(ping)
    const res = await app.fetch(await key.request(JSON.stringify(invoke("ping").build())), { DISCORD_PUBLIC_KEY: key.publicKey })
    expect(res.status).toBe(200)
  })

  test("a missing or malformed public key answers 500", async () => {
    const key = await TestKey.generate()
    const { logger } = recordingLogger()
    const request = async () => key.request(JSON.stringify(invoke("ping").build()))
    expect((await new App({ logger }).command(ping).fetch(await request(), {})).status).toBe(500)
    expect((await new App({ logger, credentials: { publicKey: "zz" } }).command(ping).fetch(await request())).status).toBe(500)
  })
})
