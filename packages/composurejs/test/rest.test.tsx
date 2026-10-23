import { describe, expect, test, vi } from "vitest"
import { App, command, CredentialsError, DiscordApiError, File, type Logger, RateLimitedError, RequestTimeoutError, Text, upload } from "composurejs"
import { addMemberRole, BotClient, createMessage, executeWebhook, getMessages, kickMember } from "composurejs/rest"
import { answer, chatInput, MockTransport, TestKey } from "composurejs/testing"

const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} }
const bot = (transport: MockTransport, maxRateLimitWait?: number) =>
  new BotClient("secret-token", { transport: transport.fetch, logger: quiet, ...(maxRateLimitWait !== undefined && { maxRateLimitWait }) })

describe("BotClient", () => {
  test("sends authorized JSON to the filled path; decodes the response", async () => {
    const transport = new MockTransport().reply(200, { id: "m1", content: "hi" })
    const message = await createMessage(bot(transport), "123", "hi")
    expect(message).toEqual({ id: "m1", content: "hi" })
    const [req] = transport.requests
    expect(req).toMatchObject({ method: "POST", path: "/channels/123/messages", json: { content: "hi" } })
    expect(req!.headers.get("authorization")).toBe("Bot secret-token")
    expect(req!.headers.get("user-agent")).toMatch(/^DiscordBot \(/)
  })

  test("a View is rendered and checked like a response; Uploads go multipart", async () => {
    const transport = new MockTransport().reply(200, {})
    await createMessage(
      bot(transport),
      "1",
      <>
        <Text>Report</Text>
        <File src={upload("r.csv", "a,b")} />
      </>,
    )
    const [req] = transport.requests
    expect(req!.json).toEqual({
      flags: 1 << 15,
      components: [
        { type: 10, content: "Report" },
        { type: 13, file: { url: "attachment://r.csv" } },
      ],
      attachments: [{ id: 0, filename: "r.csv" }],
    })
    expect(req!.files.map((f) => f.name)).toEqual(["r.csv"])
    await expect(createMessage(bot(transport), "1", <Text>{"x".repeat(4001)}</Text>)).rejects.toThrow("at most 4000 characters")
  })

  test("query strings, path escaping, audit log reasons, 204s", async () => {
    const transport = new MockTransport().reply(200, []).reply(204).reply(204)
    await getMessages(bot(transport), "9", { limit: 5, before: undefined })
    expect(await addMemberRole(bot(transport), "g", "u/../x", "r")).toBeUndefined()
    await kickMember(bot(transport), "g", "u", { reason: "spam, again" })
    expect(transport.requests.map((r) => r.path)).toEqual(["/channels/9/messages?limit=5", "/guilds/g/members/u%2F..%2Fx/roles/r", "/guilds/g/members/u"])
    expect(transport.requests[2]!.headers.get("x-audit-log-reason")).toBe("spam%2C%20again")
  })

  test("errors carry status, code and the route template, never the URL", async () => {
    const transport = new MockTransport().reply(403, { code: 50013, message: "Missing Permissions" })
    const error = await createMessage(bot(transport), "123", "x").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DiscordApiError)
    expect(error).toMatchObject({ status: 403, code: 50013, route: "POST /channels/{channel_id}/messages" })
    expect((error as Error).message).toBe("POST /channels/{channel_id}/messages: 403 (50013) Missing Permissions")
  })

  test("Discord's per-field errors are in the message and on the error", async () => {
    const errors = { components: { "0": { label: { _errors: [{ code: "BASE_TYPE_REQUIRED", message: "This field is required" }] } } } }
    const transport = new MockTransport().reply(400, { code: 50035, message: "Invalid Form Body", errors })
    const error = await createMessage(bot(transport), "1", "x").catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 400, code: 50035, errors })
    expect((error as Error).message).toBe("POST /channels/{channel_id}/messages: 400 (50035) Invalid Form Body\n  components[0].label: This field is required (BASE_TYPE_REQUIRED)")
  })

  test("short 429s are waited out; long ones throw RateLimitedError", async () => {
    vi.useFakeTimers()
    try {
      const transport = new MockTransport().reply(429, { retry_after: 0.5, global: false }).reply(200, { id: "ok" })
      const pending = createMessage(bot(transport), "1", "x")
      await vi.advanceTimersByTimeAsync(500)
      expect(await pending).toEqual({ id: "ok" })
      expect(transport.requests).toHaveLength(2)

      const limited = new MockTransport().reply(429, { retry_after: 30, global: true })
      await expect(createMessage(bot(limited), "1", "x")).rejects.toThrow(new RateLimitedError("POST /channels/{channel_id}/messages", 30, true))
      const patient = new MockTransport().reply(429, { retry_after: 30 }).reply(200, {})
      const waiting = createMessage(bot(patient, 60_000), "1", "x")
      await vi.advanceTimersByTimeAsync(30_000)
      await expect(waiting).resolves.toEqual({})
    } finally {
      vi.useRealTimers()
    }
  })

  test("requests safe to repeat are retried on network errors, timeouts and 5xx; POSTs are not", async () => {
    vi.useFakeTimers()
    try {
      const flaky = new MockTransport()
        .fail()
        .reply(503)
        .reply(200, [{ id: "m" }])
      const pending = getMessages(bot(flaky), "9")
      await vi.advanceTimersByTimeAsync(1250)
      expect(await pending).toEqual([{ id: "m" }])
      expect(flaky.requests).toHaveLength(3)

      const down = new MockTransport().reply(502).reply(502).reply(502)
      const failing = getMessages(bot(down), "9").catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(1250)
      expect(await failing).toMatchObject({ status: 502 })
      expect(down.requests).toHaveLength(3)

      const post = new MockTransport().fail()
      await expect(createMessage(bot(post), "1", "x")).rejects.toThrow("fetch failed")
      expect(post.requests).toHaveLength(1)

      const slow = new MockTransport().hang()
      const timing = createMessage(new BotClient("t", { transport: slow.fetch, logger: quiet, timeout: 500 }), "1", "x").catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(500)
      const error = await timing
      expect(error).toBeInstanceOf(RequestTimeoutError)
      expect(error).toMatchObject({ route: "POST /channels/{channel_id}/messages", timeout: 500 })
    } finally {
      vi.useRealTimers()
    }
  })

  test("a used-up bucket waits before sending, or throws when the wait is too long", async () => {
    vi.useFakeTimers()
    try {
      const headers = (remaining: number, resetAfter: number) => ({
        "X-RateLimit-Bucket": "abc",
        "X-RateLimit-Remaining": String(remaining),
        "X-RateLimit-Reset-After": String(resetAfter),
      })
      const transport = new MockTransport().reply(200, [], headers(0, 1)).reply(200, [], headers(0, 30))
      const client = new BotClient("bucket-token", { transport: transport.fetch, logger: quiet })
      await getMessages(client, "77")
      const waiting = getMessages(client, "77")
      await vi.advanceTimersByTimeAsync(999)
      expect(transport.requests).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      await waiting
      expect(transport.requests).toHaveLength(2)
      // Another channel is another bucket.
      await getMessages(client, "78")
      expect(transport.requests).toHaveLength(3)
      await expect(getMessages(client, "77")).rejects.toThrow(RateLimitedError)
      expect(transport.requests).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })

  test("executeWebhook waits for the message and allows components", async () => {
    const transport = new MockTransport().reply(200, { id: "m" })
    await executeWebhook(new BotClient("t", { transport: transport.fetch, logger: quiet }), "w", "tok", <Text>hi</Text>)
    expect(transport.requests[0]!.path).toBe("/webhooks/w/tok?wait=true&with_components=true")
  })
})

describe("in handlers", () => {
  test("c.bot uses the App's Transport and the bot token", async () => {
    const app = new App().command(command({ name: "x", description: "X", handler: async (c) => (await createMessage(c.bot, c.channelId!, "logged"), "done") }))
    const res = await answer(app, chatInput("x"))
    expect(res.text).toBe("done")
    expect(res.transport.requests[0]).toMatchObject({ path: "/channels/300000000000000001/messages", json: { content: "logged" } })
    expect(res.transport.requests[0]!.headers.get("authorization")).toBe("Bot test-bot-token")
  })

  test("c.bot without a token throws a CredentialsError", async () => {
    const key = await TestKey.generate()
    let thrown: unknown
    const app = new App({ credentials: { publicKey: key.publicKey }, logger: quiet }).command(
      command({
        name: "x",
        description: "X",
        handler: (c) => {
          try {
            void c.bot
          } catch (e) {
            thrown = e
          }
          return "ok"
        },
      }),
    )
    await app.fetch(await key.request(JSON.stringify(chatInput("x").build())))
    expect(thrown).toBeInstanceOf(CredentialsError)
  })

  test("c.client follows up with Ephemeral messages", async () => {
    const app = new App().command(command({ name: "x", description: "X", handler: async (c) => (c.waitUntil(c.client.followup(c.ephemeral("later"))), "now") }))
    const res = await answer(app, chatInput("x"))
    const [followup] = await res.settle()
    expect(followup).toMatchObject({
      method: "POST",
      path: expect.stringMatching(/^\/webhooks\/1052322265397739523\/test-interaction-token\?wait=true$/),
      json: { content: "later", flags: 64 },
    })
    expect(followup!.headers.get("authorization")).toBeNull()
  })
})
