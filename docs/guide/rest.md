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

## Errors, retries and rate limits

- A failed request throws `DiscordApiError` with `status`, Discord's `code` (50013 is Missing Permissions) and the route template. It never contains the URL, which can hold a token.
- Each attempt waits up to 10 seconds for an answer, then throws `RequestTimeoutError` (`new App({ requestTimeout })`, or `timeout` on a client built by hand).
- Requests that are safe to repeat (everything but POST) are retried twice on a network error, a timeout or a 5xx. A POST is never retried, since it could send a message twice.
- Discord's rate limit headers are tracked per bucket, so a request whose bucket is used up waits for it to reset instead of being refused. A 429 is waited out too. Either wait, when longer than 2 seconds (`maxRateLimitWait`), throws `RateLimitedError` instead: do slow work deferred.

## Endpoints that aren't wrapped

Any route in Discord's API works through `route` and `request`, typed from the spec by its operationId:

```ts twoslash
import { BotClient, route } from "composurejs/rest"
declare const bot: BotClient
// ---cut---
const getEmojis = route("GET", "/guilds/{guild_id}/emojis", "list_guild_emojis")

const emojis = await bot.request(getEmojis, { params: { guild_id: "123456789012345678" } })
```

Copy the path and operationId from the [spec](https://github.com/discord/discord-api-spec); the response type follows from the operationId.

## Outside a handler

```ts twoslash
import { BotClient, getCurrentUser } from "composurejs/rest"
// ---cut---
const bot = new BotClient(process.env.DISCORD_TOKEN!)
const me = await getCurrentUser(bot)
console.log(me.username)
```

The Endpoints cover channels, messages, pins, reactions, guilds, members, bans, roles, webhooks, users, the application and its Commands. Each is checked against the spec in CI.
