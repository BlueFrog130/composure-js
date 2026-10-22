# REST

Two clients reach Discord's REST API from a handler:

- **`c.client`**, the Interaction Client: follow-ups and the original response, authorized by the Interaction's token. It needs no bot token and works for 15 minutes.
- **`c.bot`**, the Bot Client: everything else, authorized by `DISCORD_TOKEN`. Without a token it throws, naming the variable.

Endpoints are functions in `composurejs/rest` that take a client first, so a bundle keeps only the ones it calls:

```tsx twoslash
import { command, option, Text } from "composurejs"
import { addMemberRole, createMessage } from "composurejs/rest"
const LOG_CHANNEL = "123456789012345678"
const MEMBER_ROLE = "234567890123456789"
// ---cut---
export const verify = command({
  name: "verify",
  description: "Verify a member",
  options: { user: option.user("Who") },
  handler: async (c, { user }) => {
    await addMemberRole(c.bot, c.guildId!, user.id, MEMBER_ROLE, { reason: `Verified by ${c.user.username}` })
    await createMessage(c.bot, LOG_CHANNEL, <Text>✅ {user.displayName} was verified</Text>)
    await c.client.followup(c.ephemeral("A note just for you"))
    return `${user.displayName} is verified`
  },
})
```

Message bodies take a View, which is rendered and checked like a response, files included. They also take text or a raw JSON body. Request and response types come from Discord's OpenAPI spec: hover a call to see them.

## Errors and rate limits

- A failed request throws `DiscordApiError` with `status`, Discord's `code` (50013 is Missing Permissions) and the route template. It never contains the URL, which can hold a token.
- A 429 asking to wait under 2 seconds is waited out; anything longer throws `RateLimitedError`.

## Outside a handler

```ts twoslash
import { BotClient, getCurrentUser } from "composurejs/rest"
// ---cut---
const bot = new BotClient(process.env.DISCORD_TOKEN!)
const me = await getCurrentUser(bot)
console.log(me.username)
```

The Endpoints cover channels, messages, pins, reactions, guilds, members, bans, roles, webhooks, users, the application and its Commands. Each is checked against the spec in CI.
