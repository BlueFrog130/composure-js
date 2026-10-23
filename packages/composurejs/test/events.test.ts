import { describe, expect, test } from "vitest"
import { App, AppConfigError, command, decodeEvent, type LogEntry, type Logger, type WebhookEvent } from "composurejs"
import { createDM } from "composurejs/rest"
import { answer, chatInput, sendEvent, TestKey, webhookEvent, webhookPing } from "composurejs/testing"

const ALICE = { id: "100000000000000001", username: "alice", discriminator: "0", global_name: "Alice", avatar: null }
const ENTITLEMENT = { id: "1", sku_id: "2", application_id: "3", user_id: ALICE.id, type: 8, deleted: false, consumed: false }

describe("Webhook Events", () => {
  test("are decoded, ACKed with 204 and handled as Background Work", async () => {
    const seen: WebhookEvent[] = []
    const app = new App().events(async (c, event) => {
      seen.push(event)
      if (event.type === "APPLICATION_AUTHORIZED") await createDM(c.bot, event.data.user.id)
    })
    const res = await sendEvent(app, webhookEvent("APPLICATION_AUTHORIZED", { integration_type: 1, user: ALICE, scopes: ["applications.commands"] }))
    expect(res.status).toBe(204)
    expect(seen.map((e) => e.type)).toEqual(["APPLICATION_AUTHORIZED"])
    expect(res.requests[0]).toMatchObject({ method: "POST", path: "/users/@me/channels", json: { recipient_id: ALICE.id } })
  })

  test("PING is ACKed without calling the handler; so is everything when no App sets events", async () => {
    let calls = 0
    const app = new App().events(() => void calls++)
    expect((await sendEvent(app, webhookPing())).status).toBe(204)
    expect((await sendEvent(new App(), webhookEvent("ENTITLEMENT_CREATE", ENTITLEMENT))).status).toBe(204)
    expect(calls).toBe(0)
  })

  test("unknown or mismatched events decode to unknown, never an error", () => {
    expect(decodeEvent({ type: "ENTITLEMENT_CREATE", timestamp: "t", data: ENTITLEMENT })).toMatchObject({ type: "ENTITLEMENT_CREATE", data: { sku_id: "2" } })
    for (const raw of [{ type: "BRAND_NEW", timestamp: "t", data: {} }, { type: "ENTITLEMENT_CREATE", timestamp: "t", data: { nope: 1 } }, "garbage", null]) {
      expect(decodeEvent(raw)).toEqual({ type: "unknown", raw })
    }
  })

  test("handler failures are logged, not answered", async () => {
    const entries: LogEntry[] = []
    const logger: Logger = { debug() {}, info() {}, warn() {}, error: (e) => void entries.push(e) }
    const app = new App({ logger }).events(() => {
      throw new Error("boom")
    })
    expect((await sendEvent(app, webhookEvent("ENTITLEMENT_DELETE", ENTITLEMENT))).status).toBe(204)
    expect(entries[0]).toMatchObject({ msg: "Event Handler failed", event: "ENTITLEMENT_DELETE", error: { message: "boom" } })
  })

  test("share the entrypoint and signature check; the path is configurable", async () => {
    const app = new App({ eventsPath: "/discord/events" }).command(command({ name: "ping", description: "P", handler: () => "pong" })).events(() => {})
    expect((await sendEvent(app, webhookPing(), { path: "/discord/events" })).status).toBe(204)
    expect((await answer(app, chatInput("ping"))).text).toBe("pong")
    const key = await TestKey.generate()
    const unsigned = await app.fetch(new Request("https://bot.test/discord/events", { method: "POST", body: "{}" }), { DISCORD_PUBLIC_KEY: key.publicKey })
    expect(unsigned.status).toBe(401)
  })

  test("at most one App in a tree sets events", () => {
    const app = new App().events(() => {}).route(new App().events(() => {}))
    expect(() => app.check()).toThrow(AppConfigError)
    expect(() => app.check()).toThrow("events is set twice in one App tree: at app and at app.route[0]")
  })
})
