// Interactions, events and the cron work through the bot, with composurejs/testing. A World stands
// in for Discord, GitHub and npm (one Transport answering by URL) and for Workers KV (a map).
import { beforeEach, expect, test, vi } from "vitest"
import { BotClient } from "composurejs/rest"
import {
  answer,
  autocomplete,
  chatInput,
  type Buildable,
  messageCommand,
  MockTransport,
  sendEvent,
  TEST_APPLICATION_ID,
  TEST_CHANNEL_ID,
  TEST_GUILD_ID,
  TestPlatform,
  type TestResponse,
  testUser,
  webhookEvent,
} from "composurejs/testing"
import { COMPOSURE_VERSION } from "../src/about.tsx"
import { app } from "../src/app.tsx"
import { ANNOUNCED_KEY, announceNew } from "../src/notify.tsx"
import { ERROR, FOOTER, PRIMARY, SECONDARY } from "../src/ui.tsx"
import { ANNOUNCE, FEEDBACK, follower, LOG, message, NEWS, POSTED, World } from "./world.ts"

const COMPONENTS_V2 = 1 << 15
const EPHEMERAL = 64

let world: World
let platform: TestPlatform
beforeEach(() => {
  world = new World()
  platform = new TestPlatform()
})

/** The bot's answer to `interaction`, against the World. */
const ask = (interaction: Buildable) => answer(app, interaction, { data: world.data, transport: world.fetch, platform })

type Json = Record<string, any>
const button = (res: TestResponse, label: string) => {
  const found = res.allComponents.find((c) => c.type === 2 && c.label === label)
  if (!found) throw new Error(`no ${label} in ${JSON.stringify(res.body)}`)
  return found as Json
}
const select = (res: TestResponse) => res.allComponents.find((c) => c.type === 3) as Json
const accent = (res: TestResponse) => res.components[0]?.accent_color

test("the App tree is valid", () => {
  app.check()
})

test("syncs every Command, where it may be used", () => {
  const definitions = app.definitions().map((d) => d.definition as Json)
  expect(definitions.map((d) => d.name)).toEqual(["changelog", "compare", "Explain release", "notify", "docs", "package", "feedback", "about", "invite"])
  for (const d of definitions) {
    if (d.name === "notify") {
      expect([d.contexts, d.integration_types, d.default_member_permissions]).toEqual([[0], [0], "32"])
    } else {
      expect([d.contexts, d.integration_types]).toEqual([
        [0, 1, 2],
        [0, 1],
      ])
    }
  }
})

test("/changelog opens on the latest release and pages", async () => {
  const res = await ask(chatInput("changelog"))
  expect(res.type).toBe(4)
  expect(res.text).toContain("## composurejs v0.1.2")
  expect(res.text).toContain("Released 2026-10-20 · 1 of 3")
  // Headings moved down a level, hard wraps joined
  expect(res.text).toContain("### Features\n\n**Faster cold starts**\n\nWorkers compile each function lazily.")
  expect(button(res, "◀ Newer").disabled).toBe(true)
  expect(button(res, "On GitHub").url).toBe("https://github.com/BlueFrog130/composure-js/releases/tag/composurejs%400.1.2")
  // The jump menu lists composurejs's published releases only
  expect(select(res).options.map((o: Json) => o.value)).toEqual(["0.1.2", "0.1.1", "0.1.0"])
  expect(select(res).options[0].default).toBe(true)

  // The owner turns the page in place
  const turned = await ask(res.click("Older ▶"))
  expect(turned.type).toBe(7)
  expect(turned.text).toContain("## composurejs v0.1.1")
  expect(turned.text).toContain("2 of 3")

  // Anyone else gets a copy of their own, which they then own
  const bob = { id: "200000000000000002", username: "bob" }
  const copy = await ask(res.click("Older ▶").by(bob))
  expect([copy.type, copy.isEphemeral]).toEqual([4, true])
  expect((await ask(copy.click("◀ Newer").by(bob))).type).toBe(7)

  // The jump menu
  const jumped = await ask(turned.select("Jump to a release", ["0.1.0"]))
  expect(jumped.text).toContain("## composurejs v0.1.0")
  expect(button(jumped, "Older ▶").disabled).toBe(true)

  // GitHub was asked once; every page after came from the store
  const github = world.to("https://api.github.com/")
  expect(github).toHaveLength(1)
  expect(github[0]!.headers.get("authorization")).toBe("Bearer gh-token")
  expect(github[0]!.headers.get("user-agent")).toMatch(/^composurejs-bot/)
})

test("/changelog suggests versions and explains unknown ones", async () => {
  const res = await ask(autocomplete("changelog").focused("version", "v0.1"))
  expect(res.data?.choices).toEqual([
    { name: "v0.1.2 (2026-10-20)", value: "0.1.2" },
    { name: "v0.1.1 (2026-10-20)", value: "0.1.1" },
    { name: "v0.1.0 (2026-10-20)", value: "0.1.0" },
  ])
  expect((await ask(chatInput("changelog").option("version", "v0.1.1"))).text).toContain("## composurejs v0.1.1")

  vi.spyOn(console, "debug").mockImplementation(() => {})
  const unknown = await ask(chatInput("changelog").option("version", "9.9.9"))
  expect(unknown.text).toContain("There is no release `9.9.9`")
  // The bot's Error Renderer: its error container, ephemeral
  expect(accent(unknown)).toBe(ERROR)
  expect(unknown.flags).toBe(EPHEMERAL | COMPONENTS_V2)
})

test("/compare pages through a range", async () => {
  const res = await ask(chatInput("compare").option("from", "0.1.1"))
  expect(res.text).toContain("Changes from v0.1.1 to v0.1.2: 2 releases")
  expect(res.text).toContain("1 of 2")
  const last = await ask(res.click("Older ▶"))
  expect(last.text).toContain("2 of 2")
  expect(button(last, "Older ▶").disabled).toBe(true)
})

test("Explain release reads composurejs's version from a message, and leaves composure-rs's alone", async () => {
  const embed = await ask(messageCommand("Explain release").target({ embeds: [{ title: "composurejs v0.1.1 is out" }] }))
  expect(embed.isEphemeral).toBe(true)
  expect(embed.text).toContain("## composurejs v0.1.1")

  // An announcement is Components V2: its text is in Text Displays
  const announcement = { components: [{ type: 17, components: [{ type: 10, content: "## composurejs v0.1.0 is out" }] }] } as Json
  expect((await ask(messageCommand("Explain release").target(announcement))).text).toContain("## composurejs v0.1.0")

  vi.spyOn(console, "debug").mockImplementation(() => {})
  const rust = { components: [{ type: 17, components: [{ type: 10, content: "## composure v0.1.2 is out" }] }] } as Json
  expect((await ask(messageCommand("Explain release").target(rust))).text).toContain("doesn't mention a composurejs version")
})

const notify = (subcommand: string) => chatInput("notify").subcommand(subcommand)
const setup = () => notify("setup").channel("channel", { id: NEWS, name: "news" })

test("/notify follows, lists and removes", async () => {
  const on = await ask(setup())
  expect(on.text).toContain(`announced in <#${NEWS}>`)
  expect(world.sent.map((s) => [s.method, s.path, s.json])).toEqual([
    ["GET", `/guilds/${TEST_GUILD_ID}/webhooks`, undefined],
    ["POST", `/channels/${ANNOUNCE}/followers`, { webhook_channel_id: NEWS }],
  ])
  expect(world.sent[1]!.headers.get("x-audit-log-reason")).toBe("%2Fnotify%20setup%20by%20alice")

  // Following is found again through the guild's webhooks; composure-rs's follower is not ours
  world.webhooks.push(follower("800000000000000009", NEWS), {
    ...follower("800000000000000011", NEWS),
    source_channel: { id: "600000000000000099", name: "rust-releases" },
  })
  world.webhooks.push({ id: "800000000000000010", type: 1, guild_id: TEST_GUILD_ID, channel_id: TEST_CHANNEL_ID, name: "Someone else's", avatar: null, application_id: null })
  expect((await ask(setup())).text).toContain("already gets composurejs release announcements")
  expect((await ask(notify("status"))).text).toContain(`go to <#${NEWS}>.`)

  const before = world.sent.length
  expect((await ask(notify("remove"))).text).toContain(`Stopped composurejs release announcements in <#${NEWS}>.`)
  // Only this bot's follower webhook is deleted
  expect(world.sent.slice(before).map((s) => [s.method, s.path])).toEqual([
    ["GET", `/guilds/${TEST_GUILD_ID}/webhooks`],
    ["DELETE", "/webhooks/800000000000000009"],
  ])
})

test("/notify explains a missing permission", async () => {
  world.forbidden = true
  vi.spyOn(console, "debug").mockImplementation(() => {})
  const res = await ask(notify("status"))
  expect(res.isEphemeral).toBe(true)
  expect(res.text).toContain("Manage Webhooks")
})

test("/notify preview shows the announcement", async () => {
  const res = await ask(notify("preview"))
  expect(res.flags).toBe(EPHEMERAL | COMPONENTS_V2)
  expect(accent(res)).toBe(PRIMARY)
  expect(res.text).toContain("## composurejs v0.1.2 is out")
  expect(res.text).toContain("Released 2026-10-20")
  expect(res.text).toContain(FOOTER)
  expect(res.allComponents.filter((c) => c.type === 2).map((c) => c.url)).toEqual([
    "https://github.com/BlueFrog130/composure-js/releases/tag/composurejs%400.1.2",
    "https://www.npmjs.com/package/composurejs/v/0.1.2",
    "https://bluefrog130.github.io/composure-js/",
  ])
})

test("the cron announces new releases, oldest first", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  const bot = new BotClient("bot-token", { transport: world.fetch })
  const data = world.data
  const posts = () => world.sent.filter((s) => s.path.endsWith("/messages")).length

  // First run: every release, oldest first
  expect(await announceNew(bot, data)).toEqual(["0.1.0", "0.1.1", "0.1.2"])
  expect(world.kv.get(ANNOUNCED_KEY)).toBe("0.1.2")
  expect(posts()).toBe(3)
  expect(await announceNew(bot, data)).toEqual([])

  // The last one announced was deleted: catch up without reposting
  world.kv.set(ANNOUNCED_KEY, "0.0.9")
  expect(await announceNew(bot, data)).toEqual([])
  expect(world.kv.get(ANNOUNCED_KEY)).toBe("0.1.2")
  expect(posts()).toBe(3)

  // Two releases behind: both posted, oldest first, each published to followers
  world.kv.set(ANNOUNCED_KEY, "0.1.0")
  world.sent.length = 0
  expect(await announceNew(bot, data)).toEqual(["0.1.1", "0.1.2"])
  const discord = world.to("/")
  expect(discord.map((s) => s.path)).toEqual([
    `/channels/${ANNOUNCE}/messages`,
    `/channels/${ANNOUNCE}/messages/${POSTED}/crosspost`,
    `/channels/${ANNOUNCE}/messages`,
    `/channels/${ANNOUNCE}/messages/${POSTED}/crosspost`,
  ])
  const first = discord[0]!.json as Json
  expect(first.flags).toBe(COMPONENTS_V2)
  expect(first.components[0].accent_color).toBe(PRIMARY)
  expect(JSON.stringify(first)).toContain("composurejs v0.1.1 is out")
  expect(JSON.stringify(discord[2]!.json)).toContain("composurejs v0.1.2 is out")
})

test("/docs finds guide sections and API items", async () => {
  const res = await ask(autocomplete("docs").focused("topic", "code split"))
  const [first] = res.data?.choices as Json[]
  expect(first!.name).toBe("Handlers and Views › Code splitting")

  const picked = await ask(chatInput("docs").option("topic", first!.value))
  expect(picked.text).toContain("### Handlers and Views › Code splitting")
  expect(button(picked, "Open").url).toBe("https://bluefrog130.github.io/composure-js/guide/views#code-splitting")

  // Typed text without picking a suggestion is searched; headings keep VitePress's anchors
  const typed = await ask(chatInput("docs").option("topic", "ids, deploys"))
  expect(button(typed, "Open").url).toBe("https://bluefrog130.github.io/composure-js/guide/views#ids-deploys-and-named")
  const api = await ask(chatInput("docs").option("topic", "UserError"))
  expect(button(api, "Open").url).toBe("https://github.com/BlueFrog130/composure-js/blob/main/packages/composurejs/src/errors.ts")
  expect(api.text).toContain("-# Source ·")
})

test("/package defers, then shows npm stats, cached", async () => {
  const res = await ask(chatInput("package"))
  expect(res.body).toEqual({ type: 5 })
  await platform.runBackground()
  const edit = world.sent.at(-1)!
  expect([edit.method, edit.path]).toEqual(["PATCH", `/webhooks/${TEST_APPLICATION_ID}/test-interaction-token/messages/@original`])
  const body = JSON.stringify(edit.json)
  expect(body).toContain("## composurejs 0.1.2")
  expect(body).toContain("**12,345** downloads in the last month · **678** in the last week")
  expect(world.to("https://registry.npmjs.org/composurejs")).toHaveLength(1)

  await ask(chatInput("package"))
  await platform.runBackground()
  expect(world.to("https://registry.npmjs.org/")).toHaveLength(1)

  await ask(chatInput("package").option("name", "@composurejs/vite"))
  await platform.runBackground()
  expect(world.to("https://registry.npmjs.org/@composurejs%2Fvite")).toHaveLength(1)
  expect(world.to("https://api.npmjs.org/downloads/point/last-week/@composurejs/vite")).toHaveLength(1)
})

test("/feedback reaches the maintainers", async () => {
  const opened = await ask(chatInput("feedback"))
  expect(opened.type).toBe(9)
  const res = await ask(opened.submit({ kind: "bug", title: "Crash on start", details: "It panics." }))
  expect(res.isEphemeral).toBe(true)
  expect(button(res, "Open as GitHub issue").url).toBe("https://github.com/BlueFrog130/composure-js/issues/new?title=%5BBug%5D%20Crash%20on%20start&body=It%20panics.")
  const report = world.sent.at(-1)!
  expect([report.method, report.path]).toEqual(["POST", `/channels/${FEEDBACK}/messages`])
  const json = report.json as Json
  expect(JSON.stringify(json)).toContain("### [Bug] Crash on start")
  expect(JSON.stringify(json)).toContain(`<@${testUser.id}>`)
  // Components V2 in the error tone: bugs stand out
  expect([json.flags, json.components[0].accent_color]).toEqual([COMPONENTS_V2, ERROR])
})

test("/about and /invite", async () => {
  expect((await ask(chatInput("about"))).text).toContain(`Running composurejs ${COMPOSURE_VERSION} at`)
  const invite = await ask(chatInput("invite"))
  expect(button(invite, "Add to a server").url).toBe(
    `https://discord.com/oauth2/authorize?client_id=${TEST_APPLICATION_ID}&scope=bot+applications.commands&permissions=536870912&integration_type=0`,
  )
})

test("installs are logged, and server installers welcomed", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  const user = { id: testUser.id, username: "alice", discriminator: "0" }
  const guild = { id: TEST_GUILD_ID, name: "Rustaceans", icon: null }
  const transport = new MockTransport().reply(200, message(POSTED, LOG)).reply(200, { id: "77", type: 1 }).reply(200, message(POSTED, "77"))
  const res = await sendEvent(app, webhookEvent("APPLICATION_AUTHORIZED", { integration_type: 0, user, scopes: ["bot"], guild }), { data: world.data, transport })
  expect(res.status).toBe(204)
  expect(res.requests.map((r) => r.path)).toEqual([`/channels/${LOG}/messages`, "/users/@me/channels", "/channels/77/messages"])
  const log = res.requests[0]!.json as Json
  expect(JSON.stringify(log)).toContain("### Added to a server")
  expect(JSON.stringify(log)).toContain("**Rustaceans**")
  expect([log.flags, log.components[0].accent_color]).toEqual([COMPONENTS_V2, SECONDARY])
  expect(JSON.stringify(res.requests[2]!.json)).toContain("/notify setup")

  // User installs are only logged
  const users = await sendEvent(app, webhookEvent("APPLICATION_AUTHORIZED", { integration_type: 1, user, scopes: ["applications.commands"] }), {
    data: world.data,
    transport: new MockTransport().reply(200, message(POSTED, LOG)),
  })
  expect(users.requests.map((r) => r.path)).toEqual([`/channels/${LOG}/messages`])
})
