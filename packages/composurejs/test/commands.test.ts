import { describe, expect, expectTypeOf, test, vi } from "vitest"
import {
  App,
  AppConfigError,
  command,
  createFactory,
  defineChoices,
  group,
  type LogEntry,
  type Logger,
  messageCommand,
  option,
  type PartialChannel,
  type ResolvedUser,
  type Role,
  userCommand,
} from "composurejs"
import * as t from "composurejs/testing"

function recordingLogger() {
  const entries: (LogEntry & { level: string })[] = []
  const at = (level: string) => (entry: LogEntry) => void entries.push({ level, ...entry })
  const logger: Logger = { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") }
  return { logger, entries }
}

const Flavor = defineChoices({ chocolate: "Chocolate chip", oat: "Oatmeal raisin" })

describe("Options", () => {
  test("handler values are inferred from the definition", () => {
    command({
      name: "cookie",
      description: "Give someone a cookie",
      options: {
        user: option.user("Who gets it"),
        count: option.integer("How many", { min: 1, max: 12 }).optional(),
        flavor: option.string("Flavor").choices(Flavor),
        channel: option.channel("Where").optional(),
        role: option.role("Role").optional(),
        loud: option.boolean("Loud?").optional(),
      },
      handler: (_c, values) => {
        expectTypeOf(values).toEqualTypeOf<{
          user: ResolvedUser
          flavor: "chocolate" | "oat"
          count?: number
          channel?: PartialChannel
          role?: Role
          loud?: boolean
        }>()
        return "ok"
      },
    })
  })

  test("values arrive resolved; optional ones may be missing", async () => {
    let seen: unknown
    const app = new App().command(
      command({
        name: "cookie",
        description: "Cookie",
        options: {
          user: option.user("Who"),
          count: option.integer("How many").optional(),
          flavor: option.string("Flavor").choices(Flavor),
          ratio: option.number("Ratio").optional(),
          where: option.channel("Where").optional(),
          role: option.role("Role").optional(),
          who: option.mentionable("Who else").optional(),
          file: option.attachment("File").optional(),
        },
        handler: (_c, values) => ((seen = values), `${values.user.displayName} gets ${values.count ?? 1} ${values.flavor}`),
      }),
    )
    const res = await t.answer(
      app,
      t
        .chatInput("cookie")
        .user("user", { id: "2", username: "bob", global_name: "Bob" }, { nick: "Bobby" })
        .option("flavor", "oat")
        .option("ratio", 0.5)
        .channel("where", { id: "7", name: "cookies" })
        .role("role", { id: "8", name: "bakers" })
        .user("who", { id: "3", username: "carol", global_name: null })
        .attachment("file", { id: "9", filename: "recipe.txt" }),
    )
    expect(res.text).toBe("Bobby gets 1 oat")
    expect(seen).toMatchObject({
      user: { id: "2", displayName: "Bobby", member: { nick: "Bobby" } },
      ratio: 0.5,
      where: { id: "7", name: "cookies" },
      role: { id: "8", name: "bakers" },
      who: { id: "3", displayName: "carol" },
      file: { id: "9", filename: "recipe.txt" },
    })
    expect(seen).not.toHaveProperty("count")
  })

  test("a user's displayName falls back to global name, then username; no member in DMs", async () => {
    let seen: ResolvedUser | undefined
    const app = new App().command(command({ name: "u", description: "U", options: { u: option.user("U") }, handler: (_c, { u }) => ((seen = u), "ok") }))
    await t.answer(app, t.chatInput("u").inDm().user("u", { id: "2", username: "bob", global_name: "Bob" }))
    expect(seen).toMatchObject({ displayName: "Bob", member: undefined })
  })

  test("Options that do not match the definition answer generically and warn", async () => {
    const { logger, entries } = recordingLogger()
    const app = new App({ logger }).command(command({ name: "x", description: "X", options: { n: option.integer("N") }, handler: () => "ok" }))
    expect((await t.answer(app, t.chatInput("x"))).text).toBe("Something went wrong.")
    expect((await t.answer(app, t.chatInput("x").option("n", "not a number"))).text).toBe("Something went wrong.")
    expect(entries.map((e) => [e.level, e.msg])).toEqual([
      ["warn", "Invalid Options"],
      ["warn", "Invalid Options"],
    ])
  })

  test("the definition sends required Options first and maps every setting", () => {
    const cookie = command({
      name: "cookie",
      description: "Cookie",
      options: {
        count: option.integer("How many", { min: 1, max: 12 }).optional(),
        user: option.user("Who"),
        note: option.string("Note", { maxLength: 50 }).autocomplete(() => []),
        flavor: option.string("Flavor").choices(Flavor),
        where: option.channel("Where", { types: [0, 5] }).optional(),
      },
      contexts: ["guild", "botDm"],
      integrationTypes: ["guildInstall", "userInstall"],
      defaultMemberPermissions: 8n,
      nsfw: false,
      scope: "dev",
      handler: () => "ok",
    })
    expect(cookie.definition()).toEqual({
      type: 1,
      name: "cookie",
      description: "Cookie",
      options: [
        { type: 6, name: "user", description: "Who", required: true },
        { type: 3, name: "note", description: "Note", required: true, autocomplete: true, max_length: 50 },
        {
          type: 3,
          name: "flavor",
          description: "Flavor",
          required: true,
          choices: [
            { name: "Chocolate chip", value: "chocolate" },
            { name: "Oatmeal raisin", value: "oat" },
          ],
        },
        { type: 4, name: "count", description: "How many", min_value: 1, max_value: 12 },
        { type: 7, name: "where", description: "Where", channel_types: [0, 5] },
      ],
      contexts: [0, 1],
      integration_types: [0, 1],
      default_member_permissions: "8",
      nsfw: false,
    })
  })

  test("Discord's rules are checked with the offending path", () => {
    const many = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`o${i}`, option.string("x")]))
    expect(() => command({ name: "x", description: "X", options: many, handler: () => "x" })).toThrow('Command "/x": at most 25 Options, it has 26')
    expect(() => command({ name: "x", description: "X", options: { Bad: option.string("x") }, handler: () => "x" })).toThrow(
      'Command "/x" option "Bad" "Bad" must be 1-32 lowercase',
    )
    expect(() => option.string("")).toThrow(AppConfigError)
    expect(() =>
      option
        .string("x")
        .choices(Flavor)
        .autocomplete(() => []),
    ).toThrow("both choices and autocomplete")
    const tooMany = defineChoices(Array.from({ length: 26 }, (_, i) => ({ name: `c${i}`, value: `c${i}` })))
    expect(() => command({ name: "x", description: "X", options: { c: option.string("c").choices(tooMany) }, handler: () => "x" })).toThrow("at most 25 choices")
    expect(() => command({ name: "x", description: "X", options: { n: option.integer("n", { min: 5, max: 1 }) }, handler: () => "x" })).toThrow("min is greater than max")
  })

  test("integer choices narrow to their values", () => {
    const Size = defineChoices([
      { name: "Small", value: 1 },
      { name: "Large", value: 3 },
    ])
    command({
      name: "size",
      description: "Size",
      options: { size: option.integer("Size").choices(Size) },
      handler: (_c, { size }) => {
        expectTypeOf(size).toEqualTypeOf<1 | 3>()
        return "ok"
      },
    })
  })
})

describe("Groups", () => {
  const ban = command({ name: "ban", description: "Ban", options: { user: option.user("Who") }, handler: (_c, { user }) => `banned ${user.username}` })
  const add = command({ name: "add", description: "Add role", options: { role: option.role("Role") }, handler: (_c, { role }) => `added ${role.name}` })
  const admin = group({
    name: "admin",
    description: "Admin tools",
    subcommands: [ban, group({ name: "role", description: "Roles", subcommands: [add] })],
    defaultMemberPermissions: "0",
  })

  test("dispatch to subcommands and nested Groups", async () => {
    const app = new App().command(admin)
    expect((await t.answer(app, t.chatInput("admin").subcommand("ban").user("user", { id: "2", username: "bob" }))).text).toBe("banned bob")
    expect((await t.answer(app, t.chatInput("admin").subcommand("role", "add").role("role", { id: "8", name: "mods" }))).text).toBe("added mods")
  })

  test("an unknown subcommand answers generically", async () => {
    const app = new App({ logger: recordingLogger().logger }).command(admin)
    expect((await t.answer(app, t.chatInput("admin").subcommand("kick"))).text).toBe("Something went wrong.")
  })

  test("the definition nests subcommands and groups", () => {
    expect(admin.definition()).toEqual({
      type: 1,
      name: "admin",
      description: "Admin tools",
      default_member_permissions: "0",
      options: [
        { type: 1, name: "ban", description: "Ban", options: [{ type: 6, name: "user", description: "Who", required: true }] },
        {
          type: 2,
          name: "role",
          description: "Roles",
          options: [{ type: 1, name: "add", description: "Add role", options: [{ type: 8, name: "role", description: "Role", required: true }] }],
        },
      ],
    })
  })

  test("Groups nest one level; subcommands carry no top-level settings", () => {
    const inner = group({ name: "b", description: "B", subcommands: [group({ name: "c", description: "C", subcommands: [ban] })] })
    expect(() => group({ name: "a", description: "A", subcommands: [inner] })).toThrow('Group "/a" > "b" > "c": Groups nest only one level deep')
    const scoped = command({ name: "s", description: "S", scope: "dev", handler: () => "x" })
    expect(() => group({ name: "a", description: "A", subcommands: [scoped] })).toThrow("scope can only be set on top-level Commands")
    expect(() => group({ name: "a", description: "A", subcommands: [ban, ban] })).toThrow('subcommand "ban" is listed twice')
    expect(() => group({ name: "a", description: "A", subcommands: [] })).toThrow("needs 1-25 subcommands")
  })
})

describe("context menu Commands", () => {
  test("user Commands get the resolved target user", async () => {
    const app = new App().command(userCommand({ name: "High five", handler: (_c, target) => `🙏 ${target.displayName}` }))
    expect((await t.answer(app, t.userCommand("High five").target({ id: "2", username: "bob", global_name: "Bob" }, { nick: "B" }))).text).toBe("🙏 B")
  })

  test("message Commands get the resolved target message", async () => {
    const app = new App().command(messageCommand({ name: "Quote", contexts: ["guild"], handler: (_c, message) => `> ${message.content}` }))
    expect((await t.answer(app, t.messageCommand("Quote").target({ content: "hi there" }))).text).toBe("> hi there")
  })

  test("names share a namespace only within a command type", () => {
    const a = command({ name: "quote", description: "Quote", handler: () => "x" })
    const b = messageCommand({ name: "quote", handler: () => "x" })
    expect(() => new App().command(a).command(b).check()).not.toThrow()
    expect(() => new App().command(b).command(b).check()).toThrow('Message Command "quote" is listed twice')
    expect(b.definition()).toEqual({ type: 3, name: "quote" })
  })
})

describe("autocomplete", () => {
  const flavors = ["chocolate", "oat", "peanut", "sugar"]
  const suggest = vi.fn((_c: unknown, input: string, others: Record<string, unknown>) =>
    flavors.filter((f) => f.startsWith(input)).map((f) => (others.fancy ? { name: f.toUpperCase(), value: f } : f)),
  )
  const cookie = command({
    name: "cookie",
    description: "Cookie",
    options: { flavor: option.string("Flavor").autocomplete(suggest), fancy: option.boolean("Fancy").optional() },
    handler: () => "ok",
  })

  test("suggestions answer the focused Option; strings become Choices", async () => {
    const app = new App().command(cookie)
    const res = await t.answer(app, t.autocomplete("cookie").focused("flavor", "o"))
    expect(res.body).toEqual({ type: 8, data: { choices: [{ name: "oat", value: "oat" }] } })
    const fancy = await t.answer(app, t.autocomplete("cookie").option("fancy", true).focused("flavor", "p"))
    expect(fancy.body).toEqual({ type: 8, data: { choices: [{ name: "PEANUT", value: "peanut" }] } })
  })

  test("at most 25 suggestions are sent", async () => {
    const many = command({
      name: "many",
      description: "Many",
      options: { n: option.integer("N").autocomplete(() => Array.from({ length: 40 }, (_, i) => i)) },
      handler: () => "ok",
    })
    const res = await t.answer(new App().command(many), t.autocomplete("many").focused("n", "", 4))
    expect((res.data!.choices as unknown[]).length).toBe(25)
  })

  test("over-long names are cut; empty names and over-long values are dropped and logged", async () => {
    const { logger, entries } = recordingLogger()
    const long = command({
      name: "long",
      description: "Long",
      options: {
        q: option.string("Q").autocomplete(() => [{ name: "n".repeat(120), value: "ok" }, { name: "", value: "empty" }, { name: "v", value: "v".repeat(101) }, "fine"]),
      },
      handler: () => "ok",
    })
    const res = await t.answer(new App({ logger }).command(long), t.autocomplete("long").focused("q", ""))
    expect(res.data!.choices).toEqual([
      { name: `${"n".repeat(99)}…`, value: "ok" },
      { name: "fine", value: "fine" },
    ])
    expect(entries.filter((e) => e.level === "warn")).toHaveLength(2)
  })

  test("works inside Groups", async () => {
    const app = new App().command(group({ name: "bake", description: "Bake", subcommands: [cookie] }))
    const res = await t.answer(app, t.autocomplete("bake").subcommand("cookie").focused("flavor", "su"))
    expect(res.data).toEqual({ choices: [{ name: "sugar", value: "sugar" }] })
  })

  test("a failing handler logs and suggests nothing", async () => {
    const { logger, entries } = recordingLogger()
    const broken = command({
      name: "b",
      description: "B",
      options: {
        q: option.string("Q").autocomplete(() => {
          throw new Error("db down")
        }),
      },
      handler: () => "ok",
    })
    const res = await t.answer(new App({ logger }).command(broken), t.autocomplete("b").focused("q", "x"))
    expect(res.body).toEqual({ type: 8, data: { choices: [] } })
    expect(entries[0]).toMatchObject({ level: "error", msg: "Autocomplete failed", error: { message: "db down" } })
  })
})

describe("createFactory", () => {
  test("binds the Env so c.env and c.data are typed", async () => {
    type BotEnv = { Bindings: { PREFIX: string }; Data: { emoji: string } }
    const f = createFactory<BotEnv>()
    const hi = f.command({
      name: "hi",
      description: "Hi",
      options: { name: option.string("Name") },
      handler: (c, { name }) => {
        expectTypeOf(c.env.PREFIX).toEqualTypeOf<string>()
        expectTypeOf(c.data.emoji).toEqualTypeOf<string>()
        return `${c.env.PREFIX}${name}${c.data.emoji}`
      },
    })
    const app = f.app({ data: () => ({ emoji: "👋" }) }).command(hi)
    expect((await t.answer(app, t.chatInput("hi").option("name", "Bob"), { env: { PREFIX: "> " } })).text).toBe("> Bob👋")
  })

  test("Commands written without an Env fit any App", () => {
    const app = new App<{ Bindings: { KV: object }; Data: { n: number } }>()
    app.command(command({ name: "plain", description: "Plain", handler: () => "x" }))
  })
})
