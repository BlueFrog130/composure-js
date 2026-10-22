// Signed regression fixtures: Interaction shapes as Discord sends them, each with the status
// and JSON the regression App must answer with. Replayed against every Adapter over its entry.
import { App, command, Container, group, messageCommand, option, Text, userCommand, UserError } from "composurejs"
import { TestKey } from "composurejs/testing"

const SEED = new Uint8Array(32).fill(7)
export const key = await TestKey.fromSeed(SEED)
export const env = { DISCORD_PUBLIC_KEY: key.publicKey }

const APP = "1052322265397739523"
const GUILD = "798662131062931547"
const CHANNEL = "300000000000000001"
const ALICE = { id: "100000000000000001", username: "alice", global_name: "Alice", discriminator: "0", avatar: null }

export const regressionApp = new App()
  .command(command({ name: "ping", description: "Pong", handler: () => "pong" }))
  .command(command({ name: "whoami", description: "Who am I", handler: (c) => `${c.user.global_name} in ${c.guildId ?? "DM"}` }))
  .command(
    command({
      name: "card",
      description: "A View",
      handler: () => (
        <Container accentColor={0x5865f2}>
          <Text>## Title</Text>
          <Text>
            line one
            <br />
            line two
          </Text>
        </Container>
      ),
    }),
  )
  .command(command({ name: "secret", description: "Ephemeral", handler: (c) => c.ephemeral("shh") }))
  .command(command({ name: "oops", description: "User Error", handler: () => { throw new UserError("Not here") } }))
  .command(command({ name: "crash", description: "Crash", handler: () => { throw new Error("boom", { cause: new Error("root") }) } }))
  .command(
    command({
      name: "cookie",
      description: "Options",
      options: {
        user: option.user("Who"),
        count: option.integer("How many").optional(),
        flavor: option.string("Flavor").autocomplete((_c, input) => ["chocolate", "oat"].filter((f) => f.startsWith(input))),
      },
      handler: (_c, { user, count = 1, flavor }) => `${user.displayName} gets ${count} ${flavor}`,
    }),
  )
  .command(
    group({
      name: "admin",
      description: "Group",
      subcommands: [
        command({ name: "ban", description: "Ban", options: { user: option.user("Who") }, handler: (_c, { user }) => `ban ${user.username}` }),
        group({ name: "role", description: "Roles", subcommands: [command({ name: "add", description: "Add", options: { role: option.role("Role") }, handler: (_c, { role }) => `add ${role.name}` })] }),
      ],
    }),
  )
  .command(userCommand({ name: "High five", handler: (_c, target) => `high five ${target.displayName}` }))
  .command(messageCommand({ name: "Quote", handler: (_c, message) => `> ${message.content}` }))

const base = { application_id: APP, token: "fixture-token", version: 1, locale: "en-US", entitlements: [], app_permissions: "0", attachment_size_limit: 10485760 }
const inGuild = {
  guild_id: GUILD,
  guild_locale: "en-US",
  channel: { id: CHANNEL, type: 0 },
  channel_id: CHANNEL,
  member: { user: ALICE, roles: [], joined_at: "2024-01-01T00:00:00.000Z", deaf: false, mute: false, flags: 0, permissions: "0" },
  authorizing_integration_owners: { "0": GUILD },
  context: 0,
}
const inBotDm = { channel: { id: CHANNEL, type: 1 }, channel_id: CHANNEL, user: ALICE, authorizing_integration_owners: { "1": ALICE.id }, context: 1 }
const slash = (name: string, where: object = inGuild, data: object = {}) => ({
  ...base,
  ...where,
  id: "900000000000000001",
  type: 2,
  data: { id: "800000000000000001", name, type: 1, ...data },
})
const BOB = { id: "100000000000000002", username: "bob", global_name: "Bob", discriminator: "0", avatar: null }
const BOB_MEMBER = { nick: "Bobby", roles: [], joined_at: "2024-01-01T00:00:00.000Z", flags: 0, permissions: "0" }
const MODS = { id: "200000000000000001", name: "mods", color: 0, hoist: false, position: 1, permissions: "0", managed: false, mentionable: true, flags: 0 }

const EPHEMERAL = 1 << 6
const V2 = 1 << 15
const message = (content: string, flags?: number) => ({ type: 4, data: { content, ...(flags !== undefined && { flags }) } })

export type Signing = "valid" | "tampered" | "missing" | "stale"

export interface Case {
  name: string
  body: string
  signing?: Signing
  method?: string
  status: number
  response?: unknown
}

const json = (value: unknown) => JSON.stringify(value)

export const cases: Case[] = [
  { name: "ping", body: json({ ...base, id: "900000000000000000", type: 1 }), status: 200, response: { type: 1 } },
  { name: "string response", body: json(slash("ping")), status: 200, response: message("pong") },
  { name: "member in guild", body: json(slash("whoami")), status: 200, response: message(`Alice in ${GUILD}`) },
  { name: "user in bot DM", body: json(slash("whoami", inBotDm)), status: 200, response: message("Alice in DM") },
  {
    name: "View",
    body: json(slash("card")),
    status: 200,
    response: {
      type: 4,
      data: {
        flags: V2,
        components: [{ type: 17, accent_color: 0x5865f2, components: [{ type: 10, content: "## Title" }, { type: 10, content: "line one\nline two" }] }],
      },
    },
  },
  { name: "ephemeral", body: json(slash("secret")), status: 200, response: message("shh", EPHEMERAL) },
  { name: "User Error", body: json(slash("oops")), status: 200, response: message("Not here", EPHEMERAL) },
  { name: "handler error", body: json(slash("crash")), status: 200, response: message("Something went wrong.", EPHEMERAL) },
  { name: "unknown command", body: json(slash("removed")), status: 200, response: message("Something went wrong.", EPHEMERAL) },
  {
    name: "options with resolved member",
    body: json(
      slash("cookie", inGuild, {
        options: [
          { name: "user", type: 6, value: BOB.id },
          { name: "count", type: 4, value: 3 },
          { name: "flavor", type: 3, value: "oat" },
        ],
        resolved: { users: { [BOB.id]: BOB }, members: { [BOB.id]: BOB_MEMBER } },
      }),
    ),
    status: 200,
    response: message("Bobby gets 3 oat"),
  },
  {
    name: "user-installed command in a bot DM, optional left out",
    body: json(
      slash("cookie", inBotDm, {
        options: [
          { name: "flavor", type: 3, value: "chocolate" },
          { name: "user", type: 6, value: BOB.id },
        ],
        resolved: { users: { [BOB.id]: BOB } },
      }),
    ),
    status: 200,
    response: message("Bob gets 1 chocolate"),
  },
  {
    name: "missing required option",
    body: json(slash("cookie", inGuild, { options: [{ name: "flavor", type: 3, value: "oat" }] })),
    status: 200,
    response: message("Something went wrong.", EPHEMERAL),
  },
  {
    name: "subcommand",
    body: json(
      slash("admin", inGuild, {
        options: [{ name: "ban", type: 1, options: [{ name: "user", type: 6, value: BOB.id }] }],
        resolved: { users: { [BOB.id]: BOB }, members: { [BOB.id]: BOB_MEMBER } },
      }),
    ),
    status: 200,
    response: message("ban bob"),
  },
  {
    name: "subcommand in a nested group",
    body: json(
      slash("admin", inGuild, {
        options: [{ name: "role", type: 2, options: [{ name: "add", type: 1, options: [{ name: "role", type: 8, value: MODS.id }] }] }],
        resolved: { roles: { [MODS.id]: MODS } },
      }),
    ),
    status: 200,
    response: message("add mods"),
  },
  {
    name: "user command",
    body: json({
      ...base,
      ...inGuild,
      id: "900000000000000006",
      type: 2,
      data: { id: "800000000000000002", name: "High five", type: 2, target_id: BOB.id, resolved: { users: { [BOB.id]: BOB }, members: { [BOB.id]: BOB_MEMBER } } },
    }),
    status: 200,
    response: message("high five Bobby"),
  },
  {
    name: "message command",
    body: json({
      ...base,
      ...inGuild,
      id: "900000000000000007",
      type: 2,
      data: {
        id: "800000000000000003",
        name: "Quote",
        type: 3,
        target_id: "500000000000000002",
        resolved: {
          messages: {
            "500000000000000002": { id: "500000000000000002", channel_id: CHANNEL, author: BOB, content: "cookies!", timestamp: "2024-01-01T00:00:00.000Z", edited_timestamp: null, tts: false, mention_everyone: false, mentions: [], mention_roles: [], attachments: [], embeds: [], pinned: false, type: 0 },
          },
        },
      },
    }),
    status: 200,
    response: message("> cookies!"),
  },
  {
    name: "autocomplete",
    body: json({
      ...base,
      ...inGuild,
      id: "900000000000000008",
      type: 4,
      data: { id: "800000000000000001", name: "cookie", type: 1, options: [{ name: "user", type: 6, value: BOB.id }, { name: "flavor", type: 3, value: "ch", focused: true }] },
    }),
    status: 200,
    response: { type: 8, data: { choices: [{ name: "chocolate", value: "chocolate" }] } },
  },
  {
    name: "autocomplete without handler",
    body: json({ ...base, ...inGuild, id: "900000000000000002", type: 4, data: { id: "800000000000000001", name: "ping", type: 1, options: [{ name: "q", type: 3, value: "a", focused: true }] } }),
    status: 200,
    response: { type: 8, data: { choices: [] } },
  },
  {
    name: "component without handler",
    body: json({ ...base, ...inGuild, id: "900000000000000003", type: 3, data: { custom_id: "gone:click", component_type: 2 }, message: { id: "500000000000000001", channel_id: CHANNEL, type: 0, content: "", components: [], flags: 0 } }),
    status: 200,
    response: message("This message is outdated.", EPHEMERAL),
  },
  {
    name: "modal submit without handler",
    body: json({ ...base, ...inGuild, id: "900000000000000004", type: 5, data: { custom_id: "gone:send", components: [] } }),
    status: 200,
    response: message("This message is outdated.", EPHEMERAL),
  },
  {
    name: "unknown interaction type",
    body: json({ ...base, ...inGuild, id: "900000000000000005", type: 99, data: {} }),
    status: 200,
    response: message("Something went wrong.", EPHEMERAL),
  },
  { name: "tampered body", body: json(slash("ping")), signing: "tampered", status: 401 },
  { name: "missing signature", body: json(slash("ping")), signing: "missing", status: 401 },
  { name: "stale timestamp", body: json(slash("ping")), signing: "stale", status: 401 },
  { name: "not JSON", body: "hello", status: 400 },
  { name: "not an Interaction", body: json({ hello: "world" }), status: 400 },
  { name: "oversized body", body: json({ ...slash("ping"), pad: "x".repeat(1024 * 1024) }), status: 413 },
  { name: "GET", body: "", method: "GET", signing: "missing", status: 405 },
]

/** The signed request for `kase`, at `url`. */
export async function requestFor(kase: Case, url = "https://bot.test/interactions"): Promise<Request> {
  const method = kase.method ?? "POST"
  const signing = kase.signing ?? "valid"
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (signing !== "missing") {
    const timestamp = signing === "stale" ? String(Math.floor(Date.now() / 1000) - 3600) : undefined
    Object.assign(headers, await key.sign(kase.body, timestamp))
  }
  const body = signing === "tampered" ? kase.body.replace("ping", "pong") : kase.body
  return new Request(url, { method, headers, ...(method !== "GET" && { body }) })
}
