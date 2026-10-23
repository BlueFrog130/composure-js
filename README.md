# composurejs

Discord bots that receive only **HTTP Interactions** (no gateway) and run anywhere `fetch(Request) => Response` runs: Cloudflare Workers, Bun, Node (Deno, Vercel, Netlify and Lambda later). Hono for Discord bots: a small core built on Web Standards, one `app.fetch` that Workers serves as is and a built-in server runs on Node and Bun, a typed context, and JSX Views for responses.

> Status: working so far:
>
> - Commands: typed Options, Groups, context menu Commands, inline autocomplete, Localizations
> - middleware that also guards the buttons a Command renders (the Owning Route), `c.can(Permission.X)`
> - every Components V2 and modal tag, checked against Discord's limits before sending
> - Inline Handlers: `onClick={(c) => ..}` anywhere, compiled by `@composurejs/vite` (required), with a Handler Lock that stops a deploy from breaking buttons already sent
> - Forms: typed, parsed modal values
> - file uploads
> - nested Apps
> - Cloudflare Workers, Node and Bun, built with `vite build` (Node and Bun get the Default Server, or your own entry)
> - `c.defer` / `c.deferUpdate`, and Auto Defer for handlers that turn out slow
> - REST Endpoints (Tier 1, typed from Discord's OpenAPI spec; timeouts, retries, rate limit buckets)
> - Webhook Events
> - Sync: `composure sync` from `@composurejs/cli`
> - the Dev Loop: `vite dev` serves the bot, tunnels to it, points your dev application at it, and syncs to a dev guild on every change
>
> - `pnpm create composurejs`: starter templates for Cloudflare Workers, Node and Bun
>
> - size budgets in CI (core 15 kB, the example Worker 18 kB, brotli; [ADR 0019](docs/adr/0019-budgets.md)) and a cold-start benchmark on workerd
>
> - the guide (`docs/`, VitePress): every snippet type-checked in CI
> - releases with Changesets (per-package versions, npm provenance)

```sh
pnpm create composurejs my-bot   # Cloudflare Workers, Node or Bun; then: cp .env.example .env.local && pnpm dev
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

Build with Vite (required): `composure()` compiles Inline Handlers; the other plugins decide what is built:

```ts
// vite.config.ts: Cloudflare Workers (`vite dev` runs on workerd; `vite build && wrangler deploy`)
import { cloudflare } from "@cloudflare/vite-plugin"
import composure from "@composurejs/vite"
import { defineConfig } from "vite"

export default defineConfig({ plugins: [composure(), cloudflare()], build: { minify: true } })

// Node or Bun: the Default Server around src/app.tsx, one self-contained dist/index.js
// (`server({ entry: "src/server.ts" })` builds your own server instead)
// import composure, { server } from "@composurejs/vite"
// export default defineConfig({ plugins: [composure(), server()] })
```

Develop against Discord with one command. Name your Dev Application (the only one it will repoint) and a test server in the config, `composure({ dev: { application: "<id>", guild: "<id>" } })`, put its `DISCORD_PUBLIC_KEY` and `DISCORD_TOKEN` in `.env.local` (production's go in `.env.production.local`), then `vite dev`: it opens a quick tunnel, sets the Dev Application's Interactions Endpoint URL, syncs Commands to the test server, and re-syncs on save.

Sync the Commands to Discord (shows the plan, asks, then applies; `--check` for CI):

```sh
DISCORD_TOKEN=... pnpm exec composure sync            # global; scope "dev" goes to COMPOSURE_SCOPE_DEV guilds
pnpm exec composure sync --guild 798662131062931547  # everything to one guild, to try it out
```

Tests run the App the way a platform does, with real signatures:

```ts
import { answer, chatInput } from "composurejs/testing"

const res = await answer(app, chatInput("hello").by({ id: "1", global_name: "Bob" }))
expect(res.text).toBe("## Hello, Bob")
```

## How it differs from discord-hono

[discord-hono](https://github.com/luisfun/discord-hono) is also a Hono-like framework for Discord bots on Workers. composurejs differs in these ways:

- **JSX with handlers inline, like React.** Responses are JSX, and `onClick={(c) => <Counter count={count + 1} />}` is written where the button is. The Vite plugin hoists it, each `custom_id` carries only what the handler captures, and returned markup updates the message ([ADR 0015](docs/adr/0015-inline-handlers-everywhere.md)).
- **One definition per Command.** A Command's options type its handler's arguments, so the Command Definition and the handler signature can't drift apart.
- **Explicit Apps that nest.** The same list drives both dispatch and Sync, and modules own their own lists ([ADR 0001](docs/adr/0001-explicit-registration.md)).
- **Limits are checked before Discord sees the message.** Render validates placement and Discord's limits, and throws an error naming the broken rule, so you never get a silent "This interaction failed" ([ADR 0004](docs/adr/0004-jsx-runtime.md)).
- **A Vite dev loop.** `vite dev` opens a tunnel, points the dev application at it, and syncs commands to a dev guild whenever they change.
- **Any fetch runtime** over one shared pipeline, with no adapter packages ([ADR 0024](docs/adr/0024-default-server.md)).
- **First-class testing.** `composurejs/testing` provides signed requests, Interaction builders and Background Work that runs on demand.

## Repository

| Path | What |
|---|---|
| `packages/composurejs` | Core and subpaths: `/jsx-runtime`, `/components`, `/testing`, `/rest`, `/sync`, `/placement` |
| `packages/create-composurejs` | `pnpm create composurejs`: one template generator for every target; `scripts/check-templates.mjs` installs, tests and builds each |
| `packages/cli` | `@composurejs/cli`: `composure sync`, the Sync Plan and applying it (also a library) |
| `packages/vite` | `@composurejs/vite`: `composure()` (Inline Handlers, the Dev Loop), `server()` (builds the Default Server, `/server`) |
| `packages/eslint-plugin` | `@composurejs/eslint-plugin`: flags tags placed where Discord does not allow them, in ESLint or oxlint |
| `examples/bot` | One App for Workers (`pnpm dev`, `pnpm build`, `pnpm deploy`); its build test also builds it with `server()` and runs it on Node and Bun |
| `docs` | The guide (`pnpm -C docs dev`) and the ADRs, as a VitePress site |
| `CONTEXT.md` | Glossary. Use these words. |
| `docs/adr/` | Decisions and why |

```sh
pnpm install
pnpm test        # builds the packages, then all workspace tests (incl. building and running the example on workerd, Node and Bun)
pnpm typecheck   # includes a Node-free check of core
pnpm build       # tsdown → packages/*/dist
pnpm size        # bundle budgets (size-limit)
pnpm -C examples/bot coldstart   # cold start on workerd vs. an empty Worker
```

Bots run on Node 22.12+ (or Bun, or Workers); developing this repo needs Node 22.18+ and pnpm.

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and releases. Licensed under Apache-2.0.
