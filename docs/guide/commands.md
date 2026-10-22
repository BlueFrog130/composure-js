# Commands

A Command is defined once with `command({ .. })`. Its definition (what Discord stores) and its handler's argument types both come from that one object.

## Options

```tsx twoslash
import { command, defineChoices, option } from "composurejs"

const Flavor = defineChoices({ chocolate: "Chocolate chip", oat: "Oatmeal raisin" })

export const cookie = command({
  name: "cookie",
  description: "Give someone a cookie",
  options: {
    user: option.user("Who gets it"),
    flavor: option.string("Flavor").choices(Flavor),
    count: option.integer("How many", { min: 1, max: 12 }).optional(),
  },
  handler: (c, { user, flavor, count = 1 }) => `${user.displayName} gets ${count} ${flavor} cookies`,
  //                      ^?
})
```

Option builders: `option.string`, `integer`, `number`, `boolean`, `user`, `channel` (with `types`), `role`, `mentionable` and `attachment`. Values arrive resolved:

- A `user` is the user, plus their server `member` data and a `displayName` (nickname, else display name, else username).
- A `channel`, `role` or `attachment` is the object Discord resolved with the Interaction.

`.optional()` makes a value possibly `undefined`. You may list Options in any order: required ones are sent first automatically, as Discord requires.

`.choices(..)` restricts a value to a fixed set and narrows its type (`"chocolate" | "oat"` above). `defineChoices` takes `{ value: "Shown name" }` for strings, or `[{ name, value }]` for numbers. The same Choices work for selects and radio groups.

## Autocomplete

Suggest values while the user types by declaring it on the Option:

```tsx twoslash
import { command, option } from "composurejs"
const TOPPINGS = ["sprinkles", "sea salt", "icing"]
// ---cut---
export const topping = command({
  name: "topping",
  description: "Pick a topping",
  options: {
    name: option.string("Topping").autocomplete((c, input) => TOPPINGS.filter((t) => t.startsWith(input.toLowerCase()))),
  },
  handler: (c, { name }) => `You picked ${name}`,
})
```

The handler gets the partial `input` and the raw values of the other Options filled in so far. It may return Choices or bare values; at most 25 are sent. If it throws, the error is logged and the user sees no suggestions.

## Groups

```tsx twoslash
import { command, group, option } from "composurejs"
// ---cut---
const ban = command({ name: "ban", description: "Ban a member", options: { user: option.user("Who") }, handler: (c, { user }) => `Banned ${user.username}` })
const add = command({ name: "add", description: "Add a role", options: { role: option.role("Role") }, handler: (c, { role }) => `Added ${role.name}` })

export const admin = group({
  name: "admin",
  description: "Admin tools",
  defaultMemberPermissions: "0", // hidden from everyone but admins
  subcommands: [ban, group({ name: "role", description: "Roles", subcommands: [add] })],
})
```

This gives `/admin ban` and `/admin role add`. Groups nest one level deep, as in Discord. Settings only a top-level Command can have (`contexts`, `integrationTypes`, `scope`, `defaultMemberPermissions`, `nsfw`) are rejected on subcommands.

## Context menu Commands

```tsx twoslash
import { messageCommand, userCommand } from "composurejs"
// ---cut---
export const highFive = userCommand({ name: "High five", handler: (c, target) => `🙏 ${target.displayName}` })
export const quote = messageCommand({ name: "Quote", handler: (c, message) => `> ${message.content}` })
```

They appear under right-click → Apps, and get the clicked user or message.

## Where a Command is available

| Setting | Meaning |
|---|---|
| `contexts: ["guild", "botDm", "privateChannel"]` | Where it can be used. |
| `integrationTypes: ["guildInstall", "userInstall"]` | Whether it needs the bot in the server, or works wherever the user installed the app. |
| `scope: "dev"` | Sync sends it to the guilds in `COMPOSURE_SCOPE_DEV` instead of globally ([Deploying](./deploying#scopes)). |
| `defaultMemberPermissions` | Permissions members need by default (`"0"`: admins only). |

## Listing Commands on an App

```tsx twoslash
import { App, command } from "composurejs"
const ping = command({ name: "ping", description: "Pong", handler: () => "Pong!" })
const moderation = new App()
// ---cut---
export const app = new App().command(ping).route(moderation)
```

Apps nest with `.route(..)`, so a module can own its Commands and the root lists the module. Discord's rules are checked when a Command is defined. These include lowercase names, length limits, at most 25 Options, and choices and autocomplete not used together. Rules across the whole tree, such as a Command listed twice, are checked when the App is first built. Put `app.check()` in a test to catch both before deploying.

## Typing `c.env` and `c.data`

Commands written on their own get an untyped `c.env`. To type the platform bindings, Bot Data and middleware Variables, use the factory for your App's `Env`:

```tsx twoslash
import { createFactory } from "composurejs"
// ---cut---
type BotEnv = { Bindings: { GREETING: string }; Data: { emoji: string } }
export const { command, app } = createFactory<BotEnv>()

export const hello = command({
  name: "hello",
  description: "Hello",
  handler: (c) => `${c.env.GREETING} ${c.data.emoji}`,
  //                          ^?
})
```
