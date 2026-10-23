// The Owning Route (ADR 0026): a click runs the middleware of the Command that rendered its
// handler. Compiled by @composurejs/vite, as in a bot's build.
import { describe, expect, test } from "vitest"
import { App, Button, command, Ephemeral, middleware, Permission, Row, Text, UserError } from "composurejs"
import { BotClient, createMessage } from "composurejs/rest"
import { answer, chatInput, component, MockTransport } from "composurejs/testing"

const MOD = "200000000000000002"
const STRANGER = { id: "300000000000000003", username: "eve" }

/** Only members with Ban Members get past it. */
const modsOnly = middleware((c, next) => (c.can(Permission.BanMembers) ? next() : Ephemeral("Mods only")))

const Ban = ({ target }: { target: string }) => (
  <Row>
    <Button style="danger" onClick={(c) => <Confirm target={target} by={c.user.username} />}>
      Ban
    </Button>
  </Row>
)
const Confirm = ({ target, by }: { target: string; by: string }) => (
  <Row>
    <Button onClick={() => <Text>{`${target} banned by ${by}`}</Text>}>Confirm</Button>
  </Row>
)

const moderation = new App().use(modsOnly).command(command({ name: "ban", description: "Ban", handler: () => <Ban target="spammer" /> }))
const app = new App().route(moderation).command(command({ name: "hi", description: "Hi", handler: () => <Ban target="nobody" /> }))

const mod = { id: MOD, username: "mod" }
const asMod = (b: ReturnType<typeof chatInput> | ReturnType<typeof component>) => b.by(mod).inGuild(undefined, { permissions: String(Permission.BanMembers) })

describe("Owning Route", () => {
  test("a click runs the middleware of the Command that rendered it, and keeps it on the next render", async () => {
    const opened = await answer(app, asMod(chatInput("ban")))
    const stranger = await answer(app, opened.click("Ban").by(STRANGER).inGuild(undefined, { permissions: "0" }))
    expect([stranger.text, stranger.isEphemeral]).toEqual(["Mods only", true])

    const confirm = await answer(app, asMod(opened.click("Ban")))
    expect(confirm.type).toBe(7)
    const again = await answer(app, confirm.click("Confirm").by(STRANGER).inGuild(undefined, { permissions: "0" }))
    expect(again.text).toBe("Mods only")
    expect((await answer(app, asMod(confirm.click("Confirm")))).text).toBe("spammer banned by mod")
  })

  test("other Commands' handlers do not get the guard", async () => {
    const opened = await answer(app, chatInput("hi"))
    expect((await answer(app, opened.click("Ban").by(STRANGER).inGuild(undefined, { permissions: "0" }))).type).toBe(7)
  })

  test("a route that no longer exists gets the Fallback, never the root's middleware alone", async () => {
    const opened = await answer(app, asMod(chatInput("ban")))
    const customId = opened.allComponents.find((c) => c.type === 2)!.custom_id as string
    const gone = await answer(new App().command(command({ name: "hi", description: "Hi", handler: () => "hi" })), component(customId).by(STRANGER))
    expect([gone.text, gone.isEphemeral]).toEqual(["This message is outdated.", true])
  })

  test("Views sent through c.bot and c.client inside a Command carry its route; a client built by hand does not", async () => {
    const transport = new MockTransport().reply(200, { id: "m1" }).reply(200, { id: "m2" }).reply(200, { id: "m3" })
    const post = new App().route(
      new App().use(modsOnly).command(
        command({
          name: "post",
          description: "Post",
          handler: async (c) => {
            await createMessage(c.bot, "1", <Ban target="a" />)
            await c.client.followup(<Ban target="b" />)
            await createMessage(new BotClient("t", { transport: transport.fetch }), "1", <Ban target="c" />)
            return "posted"
          },
        }),
      ),
    )
    await answer(post, asMod(chatInput("post")), { transport })
    const ids = transport.requests.map((r) => (r.json as { components: { components: { custom_id: string }[] }[] }).components[0]!.components[0]!.custom_id.split(":")[0])
    expect(ids[0]).toMatch(/^_[\w-]{7}~[0-9a-z]{5}$/)
    expect(ids[1]).toBe(ids[0])
    expect(ids[2]).toMatch(/^_[\w-]{7}$/)
  })
})

describe("permissions", () => {
  const check = new App().command(
    command({
      name: "check",
      description: "Check",
      handler: (c) => {
        if (!c.appCan(Permission.ManageRoles)) throw new UserError("I need Manage Roles")
        return c.can(Permission.KickMembers, Permission.BanMembers) ? "yes" : "no"
      },
    }),
  )

  test("c.can needs every flag; Administrator has them all; false outside a server", async () => {
    const both = String(Permission.KickMembers | Permission.BanMembers)
    const run = (b: ReturnType<typeof chatInput>) => answer(check, b.appPermissions(Permission.ManageRoles)).then((r) => r.text)
    expect(await run(chatInput("check").inGuild(undefined, { permissions: both }))).toBe("yes")
    expect(await run(chatInput("check").inGuild(undefined, { permissions: String(Permission.KickMembers) }))).toBe("no")
    expect(await run(chatInput("check").inGuild(undefined, { permissions: String(Permission.Administrator) }))).toBe("yes")
    expect(await run(chatInput("check").inDm())).toBe("no")
  })

  test("c.appCan reads the bot's permissions in the channel", async () => {
    expect((await answer(check, chatInput("check").appPermissions(0n))).text).toBe("I need Manage Roles")
    expect((await answer(check, chatInput("check").appPermissions(Permission.Administrator))).text).toBe("no")
  })
})
