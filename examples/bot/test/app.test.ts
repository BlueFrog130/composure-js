import { expect, test, vi } from "vitest"
import { answer, autocomplete, command, userCommand } from "composurejs/testing"
import { app } from "../src/app.tsx"

test("the App tree is valid", () => {
  app.check()
})

test("/ping answers Pong!", async () => {
  expect((await answer(app, command("ping"))).text).toBe("Pong!")
})

test("/hello greets by display name in a View", async () => {
  const res = await answer(app, command("hello").by({ id: "1", global_name: "Bob" }))
  expect(res.text).toBe("## Hello, Bob\n-# answered by composurejs\n- Views are JSX\n- Limits are checked before Discord sees them")
  expect(res.allComponents.find((c) => c.type === 2)).toMatchObject({ style: 5, label: "Source" })
})

test("/cookie uses resolved users and optional Options", async () => {
  const bob = { id: "2", username: "bob", global_name: "Bob" }
  expect((await answer(app, command("cookie").user("user", bob).option("flavor", "oat"))).text).toBe("Bob gets 1 oat cookie 🍪")
  expect((await answer(app, command("cookie").user("user", bob, { nick: "B" }).option("flavor", "sugar").option("count", 3).option("topping", "icing"))).text).toBe(
    "B gets 3 sugar cookies with icing 🍪",
  )
})

test("/cookie suggests toppings", async () => {
  const res = await answer(app, autocomplete("cookie").focused("topping", "S"))
  expect(res.data).toEqual({ choices: [{ name: "sprinkles", value: "sprinkles" }, { name: "sea salt", value: "sea salt" }] })
})

test("/server is guild-only through middleware", async () => {
  const dm = await answer(app, command("server").subcommand("id").inDm())
  expect([dm.text, dm.isEphemeral]).toEqual(["Run this in a server.", true])
  expect((await answer(app, command("server").subcommand("id").inGuild("123"))).text).toBe("This is guild 123")
})

test("/server member explains a non-member as a User Error", async () => {
  vi.spyOn(console, "debug").mockImplementation(() => {})
  const res = await answer(app, command("server").subcommand("member").inGuild().user("who", { id: "2", username: "bob" }))
  expect(res.text).toMatch(/^bob joined <t:\d+:R>$/)
})

test("High five is a user context menu Command", async () => {
  expect((await answer(app, userCommand("High five").target({ id: "2", username: "bob", global_name: "Bob" }))).text).toBe("alice high-fives Bob 🙏")
})
