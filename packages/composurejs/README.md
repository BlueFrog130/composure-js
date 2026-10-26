# <img src="https://raw.githubusercontent.com/BlueFrog130/composure-js/main/assets/logo.svg" width="32" height="32" alt="" align="top"> composurejs

[![npm](https://img.shields.io/npm/v/composurejs?color=5865f2)](https://www.npmjs.com/package/composurejs)
[![CI](https://github.com/BlueFrog130/composure-js/actions/workflows/ci.yml/badge.svg)](https://github.com/BlueFrog130/composure-js/actions/workflows/ci.yml)
[![Guide](https://img.shields.io/badge/docs-guide-5865f2)](https://bluefrog130.github.io/composure-js/)
[![License](https://img.shields.io/npm/l/composurejs?color=blue)](https://github.com/BlueFrog130/composure-js/blob/main/LICENSE)

Discord bots over HTTP Interactions, on any runtime that speaks `fetch`: Cloudflare Workers, Node and Bun. Typed Commands, JSX messages, and button handlers written where the button is.

```sh
pnpm create composurejs my-bot
```

## A Command

```tsx
import { App, command, option } from "composurejs"

const cookie = command({
  name: "cookie",
  description: "Give someone a cookie",
  options: {
    user: option.user("Who gets it"),
    count: option.integer("How many", { min: 1, max: 12 }).optional(),
  },
  // { user: ResolvedUser; count?: number }, inferred from `options`
  handler: (c, { user, count = 1 }) => `${user.displayName} gets ${count} 🍪`,
})

export default new App().command(cookie)
```

The options you declare are the options Discord shows and the types your handler gets. `composure sync` sends the same definitions to Discord, so the two can't drift apart.

## A message with a button

```tsx
import { Button, Container, Row, Text } from "composurejs"

const Counter = ({ count, owner }: { count: number; owner: string }) => (
  <Container>
    <Text>## Count: {count}</Text>
    <Row>
      <Button onClick={(c) => (c.user.id === owner ? <Counter count={count + 1} owner={owner} /> : c.ephemeral("Not yours"))}>
        +1
      </Button>
    </Row>
  </Container>
)
```

The handler sits on the button. [`@composurejs/vite`](https://www.npmjs.com/package/@composurejs/vite) hoists it at build time, `count` and `owner` ride along in the button's `custom_id`, and the markup it returns replaces the message. No ids to invent, nothing to register.

Every message is checked against Discord's limits when it renders. A broken rule throws an error that names it, rather than Discord's "This interaction failed".

## Slow work

```tsx
import { command, Text } from "composurejs"
import { createMessage } from "composurejs/rest"

const report = command({
  name: "report",
  description: "Slow report",
  handler: (c) =>
    c.defer(async () => {
      await createMessage(c.bot, LOG_CHANNEL, `Report requested by ${c.user.username}`)
      return <Text>Done</Text>
    }),
})
```

`c.defer` answers Discord within its 3 seconds and edits the result in when it's ready. Handlers that turn out slow are deferred for you (Auto Defer). REST Endpoints are typed from Discord's OpenAPI spec and are plain functions, so a bundle keeps only the ones it calls.

## Testing

```ts
import { answer, chatInput } from "composurejs/testing"

test("the button counts", async () => {
  const first = await answer(app, chatInput("counter"))
  const next = await answer(app, first.click("+1"))
  expect(next.text).toContain("Count: 1")
})
```

Requests are signed with a real Ed25519 key and go through the production pipeline. What would have gone to Discord is recorded instead.

## Also included

- Subcommands, groups, user and message context menu Commands, autocomplete, localizations
- Every Components V2 and modal tag, file uploads
- Typed forms: declare fields once, get parsed modal values
- Middleware that also guards the buttons a Command rendered; `c.can(Permission.X)`
- Nested Apps, so each module owns its Commands
- Webhook Events
- Structured logging with the Interaction's fields attached

About 18 kB minified and brotlied for a Worker with Commands and JSX. No runtime dependencies.

## Entry points

| Import | |
|---|---|
| `composurejs` | App, `command`, options, built-in tags, middleware |
| `composurejs/rest` | Typed REST Endpoints and the bot client |
| `composurejs/testing` | Signed Interaction builders, `answer`, mock transport |
| `composurejs/jsx-runtime` | The JSX runtime (set `jsxImportSource: "composurejs"`) |

## Learn more

- [Getting started](https://bluefrog130.github.io/composure-js/guide/getting-started)
- [The guide](https://bluefrog130.github.io/composure-js/)
- [GitHub](https://github.com/BlueFrog130/composure-js)
- [Changelog](https://github.com/BlueFrog130/composure-js/blob/main/packages/composurejs/CHANGELOG.md)

composurejs is 0.x: the API may still change between minor versions.

## License

[Apache-2.0](https://github.com/BlueFrog130/composure-js/blob/main/LICENSE)
