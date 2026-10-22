# Platforms

An App answers `fetch(request, env, platform)`. An Adapter is the few lines connecting that to a platform, each its own package: `@composurejs/adapter-cloudflare`, `@composurejs/adapter-node`, `@composurejs/adapter-bun`. The App is the same on every one.

## Cloudflare Workers

```ts twoslash
// @filename: app.ts
import { App } from "composurejs"
export const app = new App()
// @filename: worker.ts
// ---cut---
import { app } from "./app.ts"

export default app // Workers calls fetch(request, env, ctx): it fits as is
```

Secrets and bindings are `c.env`. Background Work uses `ctx.waitUntil`. Build with `@cloudflare/vite-plugin` ([Deploying](./deploying)).

## Node

`pnpm add @composurejs/adapter-node`

```ts twoslash
// @filename: app.ts
import { App } from "composurejs"
export const app = new App()
// @filename: node.ts
// ---cut---
import { serve } from "@composurejs/adapter-node"
import { app } from "./app.ts"

const server = await serve(app) // PORT, or 3000
console.info({ msg: "Listening", url: server.url })
```

`serve` answers `GET /health` and caps bodies at 1 MiB. Background Work runs on tracked promises. On SIGTERM it stops accepting requests and waits up to 30 seconds for that work.

## Bun

`pnpm add @composurejs/adapter-bun`

```ts twoslash
// @filename: app.ts
import { App } from "composurejs"
export const app = new App()
// @filename: bun.ts
// ---cut---
import { handle } from "@composurejs/adapter-bun"
import { app } from "./app.ts"

export default handle(app) // Bun serves the default export
```

## Credentials and Bot Data

Core needs only the public key, which by default it reads as `DISCORD_PUBLIC_KEY` from the env (`env` on Workers, `process.env` elsewhere). `DISCORD_TOKEN` enables `c.bot`. To load them elsewhere, or to build your own configuration once:

```tsx twoslash
import { App } from "composurejs"
declare const secrets: { get(name: string): Promise<string> }
// ---cut---
type BotEnv = { Bindings: { CONFIG_URL: string }; Data: { greeting: string } }

export const app = new App<BotEnv>({
  credentials: async (env) => ({ publicKey: await secrets.get("discord-public-key"), token: await secrets.get("discord-token") }),
  data: async (env) => (await fetch(env.CONFIG_URL)).json() as Promise<{ greeting: string }>,
})
```

Loaders run once per isolate (on Workers, at the first request) and are cached. A failing loader answers 500, is logged, and is retried on the next request.
