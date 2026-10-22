# Testing

`composurejs/testing` runs your App the way an Adapter does. Each Interaction is signed with a real Ed25519 key and goes through the full pipeline, while Discord is replaced by a recording transport. Tests never reach Discord.

```tsx twoslash
// @filename: app.tsx
import { App, Button, command, option, Row } from "composurejs"
export const app = new App()
  .command(command({ name: "greet", description: "Greet", options: { user: option.user("Who") }, handler: (c, { user }) => `hi ${user.displayName}` }))
  .command(command({ name: "counter", description: "Counter", handler: () => <Row><Button onClick={() => <Row><Button customId="x">done</Button></Row>}>Go</Button></Row> }))
// @filename: app.test.ts
// ---cut---
import { expect, test } from "vitest"
import { answer, command } from "composurejs/testing"
import { app } from "./app.tsx"

test("the App is valid", () => {
  app.check() // duplicate Commands, Discord's rules, ...
})

test("/greet greets", async () => {
  const res = await answer(app, command("greet").user("user", { id: "2", username: "bob", global_name: "Bob" }))
  expect(res.text).toBe("hi Bob")
})

test("buttons update the message", async () => {
  const first = await answer(app, command("counter"))
  const next = await answer(app, first.click("Go"))
  expect(next.type).toBe(7) // updated in place
})
```

## Builders

- `command("name")`, with `.option(name, value)`, `.user(..)`, `.role(..)`, `.channel(..)`, `.attachment(..)` and `.subcommand("group", "sub")`.
- `autocomplete("name").focused("option", "partial input")`.
- `userCommand("name").target(user)` and `messageCommand("name").target(message)`.
- `component(customId).values([..])` and `modalSubmit(customId).field(name, value)`.
- On any builder: `.by(user)`, `.inGuild(id, member?)`, `.inDm()` and `.locale("fr")`.

## Responses

A response gives you:

- what came back: `res.text`, `res.type`, `res.isEphemeral`, `res.components`, `res.allComponents`, `res.component(customId)` and `res.files`
- the next Interaction, from what it shows: `res.click("+1")`, `res.select(id, ["a"])` and `res.submit({ reason: "spam" })`

Background Work (deferred edits, follow-ups) is held until `await res.settle()`, which runs it and returns every REST request made:

```tsx twoslash
// @filename: app.tsx
import { App, command } from "composurejs"
export const app = new App().command(command({ name: "report", description: "R", handler: (c) => c.defer(async () => "done") }))
// @filename: app.test.ts
// ---cut---
import { expect, test } from "vitest"
import { answer, command } from "composurejs/testing"
import { app } from "./app.tsx"

test("/report defers, then edits", async () => {
  const res = await answer(app, command("report"))
  expect(res.body).toEqual({ type: 5 })
  const [edit] = await res.settle()
  expect(edit).toMatchObject({ method: "PATCH", json: { content: "done" } })
})
```

Pass `{ transport: new MockTransport().reply(200, {..}) }` to `answer` to script Discord's replies. `sendEvent(app, webhookEvent("ENTITLEMENT_CREATE", data))` delivers a Webhook Event.
