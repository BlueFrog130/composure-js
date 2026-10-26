# Middleware

Middleware wraps handlers, as in Hono. It works by return value: `next()` resolves to the inner answer. Return it, return something else to short-circuit, or return nothing to pass it on.

```tsx twoslash
import { App, command, Ephemeral, middleware } from "composurejs"
const ban = command({ name: "ban", description: "Ban", handler: () => "Banned" })
// ---cut---
const guildOnly = middleware((c, next) => (c.guildId ? next() : Ephemeral("Run this in a server.")))

const timing = middleware(async (c, next) => {
  const start = Date.now()
  const answer = await next()
  console.info({ msg: "answered", ms: Date.now() - start, type: c.interaction.type })
  return answer
})

const moderation = new App().use(guildOnly).command(ban)
export const app = new App().use(timing).route(moderation)
```

- **Scope.** An App's middleware covers every Command it lists, whether `.use` comes before or after them. A nested App's runs inside its parents' and covers only its own Commands: `guildOnly` above guards `/ban` but no other Command.
- **Clicks and modal submits** run the middleware of the Command whose answer rendered them, and keep it for whatever they render next. `guildOnly` above also guards the buttons `/ban` answers with, and the buttons those buttons render. Messages sent outside any Command (from a Webhook Event, or with a `BotClient` you built yourself) run the root App's middleware. If the Command is later removed, its old buttons answer "This message is outdated.".
- **Errors** thrown in middleware reach the [Error Renderer](./responses#errors) like handler errors.

## Variables

Values for later middleware and handlers go on `c`, typed through the App's `Env`:

```tsx twoslash
import { createFactory } from "composurejs"
// ---cut---
type BotEnv = { Variables: { locale: "en" | "fr" } }
const { app, command, middleware } = createFactory<BotEnv>()

const locale = middleware((c, next) => {
  c.set("locale", c.locale?.startsWith("fr") ? "fr" : "en")
  return next()
})

export const bot = app()
  .use(locale)
  .command(command({ name: "hi", description: "Hi", handler: (c) => (c.var.locale === "fr" ? "Salut !" : "Hi!") }))
```

## Permissions

`c.can` checks the invoking member's permissions in the channel, `c.appCan` the bot's. Both need every flag given; Administrator has them all, and outside a server `c.can` is false:

```tsx twoslash
import { App, command, Ephemeral, middleware, Permission } from "composurejs"
const ban = command({ name: "ban", description: "Ban", handler: () => "Banned" })
// ---cut---
const modsOnly = middleware((c, next) => (c.can(Permission.BanMembers) ? next() : Ephemeral("Mods only.")))

export const moderation = new App().use(modsOnly).command(ban)
```

Discord's `defaultMemberPermissions` hides a Command from members without the permissions, but anyone who can see a message can press its buttons. A guard like `modsOnly` covers both: the Command and every button it renders.
