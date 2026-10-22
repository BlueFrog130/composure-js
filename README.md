# composurejs

Discord bots that receive only **HTTP Interactions** (no gateway) and run anywhere `fetch(Request) => Response` runs: Cloudflare Workers, Bun, Node (Deno, Vercel, Netlify and Lambda later). Hono for Discord bots: a small core built on Web Standards, one `app.fetch`, a thin Adapter per platform, a typed context, and JSX Views for responses.

> Status: milestone 4. Working so far:
>
> - Commands: typed Options, Groups, context menu Commands, inline autocomplete
> - middleware
> - every Components V2 and modal tag, checked against Discord's limits before sending
> - file uploads
> - Views with Inline Handlers, hoisted by `@composurejs/vite`
> - Component and Modal Handlers, with modal values typed by Fields
> - nested Apps
> - the Cloudflare, Node and Bun Adapters
> - `c.defer` / `c.deferUpdate`
> - REST Endpoints (Tier 1, typed from Discord's OpenAPI spec)
> - Webhook Events
>
> Next: Sync, and the Vite dev loop and build targets.

```tsx
import { App, Button, command, Container, p, Row, Text, view } from "composurejs"

export const Card = view("card", {
  props: { title: p.string(), likes: p.int() },
  render: ({ title, likes }, on) => (
    <Container>
      <Text>## {title}</Text>
      <Row>
        <Button onClick={on("like", () => Card({ title, likes: likes + 1 }))}>👍 {likes}</Button>
      </Row>
    </Container>
  ),
})
// The click re-renders the message from new Props; its custom_id is "card:like:<title>:<likes>".

// Deferred work and REST (Endpoints are functions, so a bundle keeps only those it calls):
import { createMessage } from "composurejs/rest"
const report = command({
  name: "report",
  description: "Slow report",
  handler: (c) => c.defer(async () => {
    await createMessage(c.bot, LOG_CHANNEL, `Report requested by ${c.user.username}`)
    return <Text>Done</Text>
  }),
})
const app = new App().command(command({ name: "card", description: "A card", handler: () => <Card title="Hi" likes={0} /> })).view(Card)
```

```tsx
import { App, command, Container, option, Text } from "composurejs"

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

const hello = command({
  name: "hello",
  description: "Say hello",
  handler: (c) => (
    <Container accentColor={0x5865f2}>
      <Text>## Hello, {c.user.global_name}</Text>
    </Container>
  ),
})

const app = new App().command(cookie).command(hello)

export default app // Workers: reads DISCORD_PUBLIC_KEY from env
```

```ts
// Node
import { serve } from "composurejs/node"
await serve(app, { port: 3000 })

// Bun
import { handle } from "composurejs/bun"
export default handle(app)
```

Tests run the App the way an Adapter does, with real signatures:

```ts
import { answer, command } from "composurejs/testing"

const res = await answer(app, command("hello").by({ id: "1", global_name: "Bob" }))
expect(res.text).toBe("## Hello, Bob")
```

## How it differs from discord-hono

[discord-hono](https://github.com/luisfun/discord-hono) is also a Hono-like framework for Discord bots on Workers. composurejs differs in these ways:

- **JSX Views.** Responses are JSX, and component handlers are written inline in the markup. The Vite plugin hoists them, and each `custom_id` carries only the values the handler captures ([ADR 0005](docs/adr/0005-view-inline-handlers.md)).
- **One definition per Command.** A Command's options type its handler's arguments, so the Command Definition and the handler signature can't drift apart.
- **Explicit Apps that nest.** The same list drives both dispatch and Sync, and modules own their own lists ([ADR 0001](docs/adr/0001-explicit-registration.md)).
- **Limits are checked before Discord sees the message.** Render validates placement and Discord's limits, and throws an error naming the broken rule, so you never get a silent "This interaction failed" ([ADR 0004](docs/adr/0004-jsx-runtime.md)).
- **A Vite dev loop.** `vite dev` opens a tunnel, points the dev application at it, and syncs commands to a dev guild whenever they change.
- **Multi-runtime Adapters** over one shared pipeline ([ADR 0007](docs/adr/0007-adapters-and-background-work.md)).
- **First-class testing.** `composurejs/testing` provides signed requests, Interaction builders and Background Work that runs on demand.

## Repository

| Path | What |
|---|---|
| `packages/composurejs` | Core and subpaths: `/jsx-runtime`, `/components`, `/testing`, `/cloudflare`, `/node`, `/bun` |
| `packages/vite` | `@composurejs/vite`: hoists Views' Inline Handlers (the dev loop and build targets come later) |
| `examples/bot` | One App served by Node (`pnpm dev:node`), Workers (`pnpm dev:worker`) and Bun (`bun src/bun.ts`) |
| `CONTEXT.md` | Glossary. Use these words. |
| `docs/adr/` | Decisions and why |

```sh
pnpm install
pnpm test        # all workspace tests (Vitest projects)
pnpm typecheck   # includes a Node-free check of core
pnpm build       # tsdown → packages/*/dist
```

Bots run on Node 20.19+; developing this repo needs Node 22.18+ and pnpm.
