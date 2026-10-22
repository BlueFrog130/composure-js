import { describe, expect, test } from "vitest"
import { App, command, group, messageCommand, option, type ScopedDefinition } from "composurejs"
import { MockTransport } from "composurejs/testing"
import { apply, configFromEnv, counts, formatPlan, hasChanges, plan, same, type SyncConfig, SyncError, targets } from "composurejs/sync"

const APP_ID = "1052322265397739523"
const DEV_GUILD = "798662131062931547"
const OTHER_GUILD = "798662131062931548"

const ping = command({ name: "ping", description: "Pong", handler: () => "pong" })
const debug = command({ name: "debug", description: "Debug", scope: "dev", contexts: ["guild"], handler: () => "d" })
const cookie = command({ name: "cookie", description: "Cookie", options: { user: option.user("Who") }, contexts: ["guild", "botDm"], handler: () => "c" })
const quote = messageCommand({ name: "Quote", handler: () => "q" })
const defs = (...cmds: Parameters<App["command"]>[0][]): ScopedDefinition[] => cmds.reduce((app, c) => app.command(c), new App()).definitions()

const config = (scopes: Record<string, string[]> = {}): SyncConfig => ({ token: "t", applicationId: APP_ID, scopes })

/** What Discord returns for a stored Command: our definition plus its defaults and ids. */
const stored = (definition: object) => ({
  id: "1",
  application_id: APP_ID,
  version: "1",
  type: 1,
  default_member_permissions: null,
  nsfw: false,
  dm_permission: true,
  description_localizations: null,
  name_localizations: null,
  integration_types: [0],
  contexts: [0, 1, 2],
  ...definition,
})

describe("configFromEnv", () => {
  test("reads the token, application id and scopes", () => {
    expect(configFromEnv({ DISCORD_TOKEN: "t", DISCORD_APPLICATION_ID: APP_ID, COMPOSURE_SCOPE_DEV: `${DEV_GUILD}, ${OTHER_GUILD}`, COMPOSURE_SCOPE_EMPTY: "" })).toEqual({
      token: "t",
      applicationId: APP_ID,
      scopes: { DEV: [DEV_GUILD, OTHER_GUILD] },
    })
  })

  test("takes the application id from a bot token when unset", () => {
    const token = `${btoa(APP_ID).replace(/=+$/, "")}.Gx1234.secret`
    expect(configFromEnv({ DISCORD_TOKEN: token }).applicationId).toBe(APP_ID)
  })

  test("names what is missing or malformed", () => {
    expect(() => configFromEnv({})).toThrow("DISCORD_TOKEN is not set")
    expect(() => configFromEnv({ DISCORD_TOKEN: "not-a-bot-token" })).toThrow("DISCORD_APPLICATION_ID is not set")
    expect(() => configFromEnv({ DISCORD_TOKEN: "t", DISCORD_APPLICATION_ID: APP_ID, COMPOSURE_SCOPE_DEV: "abc" })).toThrow('COMPOSURE_SCOPE_DEV: "abc" is not a guild id')
  })
})

describe("targets", () => {
  test("global gets unscoped Commands; each Scope's guilds get theirs, without global-only settings", () => {
    const out = targets(defs(ping, debug, quote), config({ DEV: [DEV_GUILD] }))
    expect(out.map((t) => [t.label, t.commands.map((c) => c.name)])).toEqual([
      ["global", ["ping", "Quote"]],
      [`guild ${DEV_GUILD} (dev)`, ["debug"]],
    ])
    expect(out[1]!.commands[0]).not.toHaveProperty("contexts")
  })

  test("every listed guild is a target, so removing its last Command clears it", () => {
    expect(targets(defs(ping), config({ DEV: [DEV_GUILD] })).map((t) => [t.label, t.commands.length])).toEqual([
      ["global", 1],
      [`guild ${DEV_GUILD} (dev)`, 0],
    ])
  })

  test("--guild sends everything to one guild", () => {
    expect(targets(defs(ping, debug, cookie), { ...config(), guild: OTHER_GUILD }).map((t) => [t.label, t.commands.map((c) => c.name)])).toEqual([[`guild ${OTHER_GUILD}`, ["ping", "debug", "cookie"]]])
  })

  test("a Scope without guilds is an error naming the env var", () => {
    expect(() => targets(defs(debug), config())).toThrow(new SyncError('/debug has scope "dev", but COMPOSURE_SCOPE_DEV lists no guilds'))
  })
})

describe("plan", () => {
  test("compares with Discord's stored Commands, ignoring its defaults", async () => {
    const transport = new MockTransport()
      .reply(200, [
        stored(ping.definition()),
        stored({ ...cookie.definition(), description: "Old description" }),
        stored({ name: "gone", description: "Removed from code" }),
      ])
      .reply(200, [])
    const result = await plan(defs(ping, cookie, quote, debug), config({ DEV: [DEV_GUILD] }), { transport: transport.fetch })
    expect(transport.requests.map((r) => [r.method, r.path])).toEqual([
      ["GET", `/applications/${APP_ID}/commands?with_localizations=true`],
      ["GET", `/applications/${APP_ID}/guilds/${DEV_GUILD}/commands?with_localizations=true`],
    ])
    expect(transport.requests[0]!.headers.get("authorization")).toBe("Bot t")
    expect(result.targets.map((t) => [t.label, t.changes, t.unchanged])).toEqual([
      [
        "global",
        [
          { kind: "update", label: "/cookie" },
          { kind: "create", label: "Quote (message)" },
          { kind: "delete", label: "/gone" },
        ],
        1,
      ],
      [`guild ${DEV_GUILD} (dev)`, [{ kind: "create", label: "/debug" }], 0],
    ])
    expect(counts(result)).toEqual({ create: 2, update: 1, delete: 1 })
    expect(formatPlan(result)).toBe(
      [
        "global: (1 unchanged)",
        "  ~ /cookie",
        "  + Quote (message)",
        "  - /gone",
        `guild ${DEV_GUILD} (dev):`,
        "  + /debug",
        "2 to create, 1 to update, 1 to delete",
      ].join("\n"),
    )
  })

  test("contexts and integration types are compared only when the Command sets them", () => {
    expect(same(ping.definition(), stored(ping.definition()) as never)).toBe(true)
    expect(same(cookie.definition(), stored({ ...cookie.definition(), contexts: [0, 1, 2] }) as never)).toBe(false)
    expect(same(cookie.definition(), stored({ ...cookie.definition(), contexts: [0, 1] }) as never)).toBe(true)
    const admin = group({ name: "admin", description: "A", subcommands: [command({ name: "ban", description: "B", options: { n: option.integer("N", { min: 1 }) }, handler: () => "x" })] })
    // Discord returns 1.0 bounds and explicit defaults like autocomplete: false.
    const fromDiscord = JSON.parse(JSON.stringify(admin.definition()).replace('"min_value":1', '"min_value":1.0,"autocomplete":false'))
    expect(same(admin.definition(), stored(fromDiscord) as never)).toBe(true)
  })

  test("an up-to-date App plans nothing", async () => {
    const transport = new MockTransport().reply(200, [stored(ping.definition())])
    const result = await plan(defs(ping), config(), { transport: transport.fetch })
    expect(hasChanges(result)).toBe(false)
    expect(formatPlan(result)).toBe("global: up to date (1 unchanged)\nDiscord is up to date")
  })
})

describe("apply", () => {
  test("overwrites only the targets with changes, in one bulk request each", async () => {
    const transport = new MockTransport().reply(200, [stored(ping.definition())]).reply(200, [])
    const cfg = config({ DEV: [DEV_GUILD] })
    const result = await plan(defs(ping, debug), cfg, { transport: transport.fetch })
    await apply(result, cfg, { transport: transport.fetch })
    const puts = transport.requests.filter((r) => r.method === "PUT")
    expect(puts.map((r) => r.path)).toEqual([`/applications/${APP_ID}/guilds/${DEV_GUILD}/commands`])
    expect(puts[0]!.json).toEqual([{ type: 1, name: "debug", description: "Debug" }])
  })
})
