<p align="center">
  <img src="assets/logo.svg" width="96" height="96" alt="composurejs logo">
</p>

<h1 align="center">composurejs</h1>

<p align="center">
  Discord bots over HTTP Interactions, on any runtime that speaks <code>fetch</code>.<br>
  Typed Commands, JSX messages, and button handlers written where the button is.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/composurejs"><img src="https://img.shields.io/npm/v/composurejs?color=5865f2&label=npm" alt="npm version"></a>
  <a href="https://github.com/BlueFrog130/composure-js/actions/workflows/ci.yml"><img src="https://github.com/BlueFrog130/composure-js/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://bluefrog130.github.io/composure-js/"><img src="https://img.shields.io/badge/docs-guide-5865f2" alt="Guide"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/composurejs?color=blue" alt="License: Apache-2.0"></a>
</p>

<p align="center">
  <a href="https://bluefrog130.github.io/composure-js/guide/getting-started">Getting started</a> ·
  <a href="https://bluefrog130.github.io/composure-js/">Guide</a> ·
  <a href="docs/adr">Design decisions</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

A composurejs bot is a function from `Request` to `Response`. There is no gateway connection to keep alive, so the same App runs on Cloudflare Workers, Node and Bun, and you test it by calling it.

```tsx
import { App, Button, command, Container, Row, Text } from "composurejs"

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

export default new App().command(
  command({ name: "counter", description: "A counter", handler: (c) => <Counter count={0} owner={c.user.id} /> }),
)
```

The click handler lives on the button. There are no custom ids to invent and nothing to register: the Vite plugin hoists the handler, `count` and `owner` travel in the button's `custom_id`, and the markup the handler returns replaces the message.

## Quick start

```sh
pnpm create composurejs my-bot
```

Pick Cloudflare Workers, Node or Bun, give it your development application and a test server, then `pnpm dev`. It serves the bot, opens a tunnel, points the application at it and syncs your Commands. Type `/counter` in Discord.

The [getting started guide](https://bluefrog130.github.io/composure-js/guide/getting-started) walks through it.

## Features

- **Commands typed from their definition.** A Command's options type its handler's arguments, so the definition Discord sees and the code that runs can't drift apart. Subcommands, groups, context menu Commands, autocomplete and localizations included.
- **JSX for messages.** Every Components V2 and modal tag, checked against Discord's limits when it renders. A message that breaks a rule throws an error naming the rule, instead of Discord's "This interaction failed".
- **Handlers inline.** `onClick`, `onSelect` and `onSubmit` take a function wherever the component is. A Handler Lock catches a deploy that would break buttons already sent.
- **Typed forms.** Declare fields once, get parsed and typed modal values back.
- **Middleware that guards buttons too.** A Command's middleware also runs for the components it rendered. `c.can(Permission.ManageMessages)` for permission checks.
- **Deferred responses.** `c.defer(async () => ...)` for slow work, and Auto Defer for handlers that turn out slow.
- **REST client.** Endpoints typed from Discord's OpenAPI spec, with timeouts, retries and rate limit buckets. Each Endpoint is a function, so a bundle only keeps the ones it calls.
- **One-command dev loop.** `vite dev` tunnels to your machine, repoints your dev application, and re-syncs Commands to a test server on every save.
- **Testing built in.** `composurejs/testing` sends signed Interactions through the real pipeline and records what would have gone to Discord.
- **Small.** About 18 kB minified and brotlied for a Worker with Commands and JSX, zero runtime dependencies. CI fails the build past its size budget.

## Runs on

| Runtime | How |
|---|---|
| Cloudflare Workers | `export default app`, built with `@cloudflare/vite-plugin` |
| Node 22.12+ | `server()` from `@composurejs/vite` builds a self-contained server |
| Bun | the same server build |

```ts
// vite.config.ts
import { cloudflare } from "@cloudflare/vite-plugin"
import composure from "@composurejs/vite"
import { defineConfig } from "vite"

export default defineConfig({ plugins: [composure(), cloudflare()] })
// Node or Bun: plugins: [composure(), server()]
```

## Testing

```ts
import { answer, chatInput } from "composurejs/testing"

test("the button counts", async () => {
  const first = await answer(app, chatInput("counter"))
  const next = await answer(app, first.click("+1"))
  expect(next.text).toContain("Count: 1")
})
```

Every request is signed with a real Ed25519 key and goes through the same pipeline as production. Nothing reaches Discord.

## Packages

| Package | Version | |
|---|---|---|
| [`composurejs`](packages/composurejs) | [![npm](https://img.shields.io/npm/v/composurejs?color=5865f2&label=)](https://www.npmjs.com/package/composurejs) | The framework: App, Commands, JSX, REST, testing |
| [`@composurejs/vite`](packages/vite) | [![npm](https://img.shields.io/npm/v/@composurejs/vite?color=5865f2&label=)](https://www.npmjs.com/package/@composurejs/vite) | Compiles inline handlers, builds for each runtime, runs the dev loop |
| [`@composurejs/cli`](packages/cli) | [![npm](https://img.shields.io/npm/v/@composurejs/cli?color=5865f2&label=)](https://www.npmjs.com/package/@composurejs/cli) | `composure sync`: puts your Commands on Discord |
| [`@composurejs/eslint-plugin`](packages/eslint-plugin) | [![npm](https://img.shields.io/npm/v/@composurejs/eslint-plugin?color=5865f2&label=)](https://www.npmjs.com/package/@composurejs/eslint-plugin) | Flags components placed where Discord won't accept them, for ESLint and oxlint |
| [`create-composurejs`](packages/create-composurejs) | [![npm](https://img.shields.io/npm/v/create-composurejs?color=5865f2&label=)](https://www.npmjs.com/package/create-composurejs) | `pnpm create composurejs` |

## Compared to discord-hono

[discord-hono](https://github.com/luisfun/discord-hono) is also a Hono-like framework for Discord bots on Workers. composurejs differs in these ways:

- **JSX with inline handlers**, compiled by a Vite plugin ([ADR 0015](docs/adr/0015-inline-handlers-everywhere.md)).
- **One definition per Command** types its handler and drives Sync.
- **Explicit Apps that nest**, so modules own their Commands ([ADR 0001](docs/adr/0001-explicit-registration.md)).
- **Limits checked at render** with errors that name the rule ([ADR 0004](docs/adr/0004-jsx-runtime.md)).
- **A dev loop** that tunnels, repoints and syncs.
- **Workers, Node and Bun** over one pipeline, with no adapter packages ([ADR 0024](docs/adr/0024-default-server.md)).

## Status

composurejs is 0.x. It runs in production (this repo deploys [its own bot](bots/composure)), but the API may still change between minor versions. Changes are listed in each package's CHANGELOG and on the [releases page](https://github.com/BlueFrog130/composure-js/releases).

It is a TypeScript port of the ideas in [composure-rs](https://github.com/BlueFrog130/composure-rs).

## Developing this repo

| Path | What |
|---|---|
| `packages/composurejs` | Core and subpaths: `/jsx-runtime`, `/components`, `/testing`, `/rest`, `/sync`, `/placement` |
| `packages/vite` | `composure()` (inline handlers, the dev loop), `server()` (the Default Server) |
| `packages/cli` | `composure sync` (also a library) |
| `packages/eslint-plugin` | The `placement` rule |
| `packages/create-composurejs` | One template generator for every runtime |
| `examples/bot` | One App, built and run on workerd, Node and Bun by its tests |
| `bots/composure` | composurejs's own bot, deployed to Workers |
| `docs` | The guide and the ADRs (VitePress) |
| `CONTEXT.md` | The glossary |

```sh
pnpm install
pnpm test        # builds the packages, then every workspace test
pnpm typecheck   # includes a Node-free check of core
pnpm size        # bundle budgets
pnpm -C docs dev # the guide
```

Developing needs Node 22.18+ and pnpm. See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and releases.

## License

[Apache-2.0](LICENSE)
