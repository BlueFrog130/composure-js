# composurejs

Discord bots that receive only **HTTP Interactions** (no gateway) and run anywhere `fetch(Request) => Response` runs: Cloudflare Workers, Bun, Node (Deno, Vercel, Netlify and Lambda later). Hono for Discord bots: a small core built on Web Standards, one `app.fetch`, a thin Adapter per platform, a typed context, and JSX Views for responses.

> Status: working so far:
>
> - Commands: typed Options, Groups, context menu Commands, inline autocomplete
> - middleware
> - every Components V2 and modal tag, checked against Discord's limits before sending
> - Inline Handlers: `onClick={(c) => ..}` anywhere, compiled by `@composurejs/vite` (required)
> - file uploads
> - nested Apps
> - the Cloudflare, Node and Bun Adapters, built with `vite build`
> - `c.defer` / `c.deferUpdate`
> - REST Endpoints (Tier 1, typed from Discord's OpenAPI spec)
> - Webhook Events
> - Sync: `composure sync` from `@composurejs/cli`
> - the Dev Loop: `vite dev` serves the bot, tunnels to it, points your dev application at it, and syncs to a dev guild on every change
>
> - `pnpm create composurejs`: starter templates for Cloudflare Workers, Node and Bun
>
> Next: size and cold-start budgets, the docs site, releases.

```sh
pnpm create composurejs my-bot   # Cloudflare Workers, Node or Bun; then: cp .env.example .env && pnpm dev
```

```tsx
import { App, Button, command, Container, Row, Text } from "composurejs"

const Counter = ({ count, owner }: { count: number; owner: string }) => (
  <Container>
    <Text>## Count: {count}</Text>
    <Row>
      <Button onClick={(c) => (c.user.id === owner ? <Counter count={count + 1} owner={owner} /> : c.ephemeral("Not yours"))}>+1</Button>
    </Row>
  </Container>
)
// The click updates the message with the markup it returns. No ids to choose, nothing to register:
// the plugin hoists the handler, and count and owner travel in its custom_id.

const app = new App().command(command({ name: "counter", description: "A counter", handler: (c) => <Counter count={0} owner={c.user.id} /> }))

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

Build with Vite (required); the plugin compiles Inline Handlers and sets up the target:

```ts
// vite.config.ts: Cloudflare Workers (`vite dev` runs on workerd; `vite build && wrangler deploy`)
import { cloudflare } from "@cloudflare/vite-plugin"
import composure from "@composurejs/vite"
import { defineConfig } from "vite"

export default defineConfig({ plugins: [composure({ target: "cloudflare" }), cloudflare()] })

// Node or Bun: one self-contained dist/index.js
// export default defineConfig({ plugins: [composure({ target: "node", entry: "src/node.ts" })] })
```

Develop against Discord with one command. Put `DISCORD_PUBLIC_KEY`, `DISCORD_TOKEN`, `COMPOSURE_DEV_APPLICATION_ID` (your *dev* application, the only one it will repoint) and `COMPOSURE_DEV_GUILD` in `.env`, then `vite dev`: it opens a tunnel, sets the dev application's Interactions Endpoint URL, syncs Commands to the dev guild, and re-syncs on save.

Sync the Commands to Discord (shows the plan, asks, then applies; `--check` for CI):

```sh
DISCORD_TOKEN=... pnpm exec composure sync            # global; scope "dev" goes to COMPOSURE_SCOPE_DEV guilds
pnpm exec composure sync --guild 798662131062931547  # everything to one guild, to try it out
```

Tests run the App the way an Adapter does, with real signatures:

```ts
import { answer, command } from "composurejs/testing"

const res = await answer(app, command("hello").by({ id: "1", global_name: "Bob" }))
expect(res.text).toBe("## Hello, Bob")
```

## How it differs from discord-hono

[discord-hono](https://github.com/luisfun/discord-hono) is also a Hono-like framework for Discord bots on Workers. composurejs differs in these ways:

- **JSX with handlers inline, like React.** Responses are JSX, and `onClick={(c) => <Counter count={count + 1} />}` is written where the button is. The Vite plugin hoists it, each `custom_id` carries only what the handler captures, and returned markup updates the message ([ADR 0015](docs/adr/0015-inline-handlers-everywhere.md)).
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
| `packages/create-composurejs` | `pnpm create composurejs`: one template generator for every target; `scripts/check-templates.mjs` installs, tests and builds each |
| `packages/cli` | `@composurejs/cli`: `composure sync`, the Sync Plan and applying it (also a library) |
| `packages/vite` | `@composurejs/vite`: compiles Inline Handlers and sets up `vite build` per target (the dev loop comes later) |
| `examples/bot` | One App built for Workers (`pnpm dev`, `pnpm build`, `pnpm deploy`), Node (`pnpm build:node && pnpm start:node`) and Bun (`pnpm build:bun && bun dist/bun/index.js`) |
| `CONTEXT.md` | Glossary. Use these words. |
| `docs/adr/` | Decisions and why |

```sh
pnpm install
pnpm test        # builds the packages, then all workspace tests (incl. building and running the example per target)
pnpm typecheck   # includes a Node-free check of core
pnpm build       # tsdown → packages/*/dist
```

Bots run on Node 20.19+; developing this repo needs Node 22.18+ and pnpm.
