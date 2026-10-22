# Platforms

An App answers `fetch(request, env, platform)`, so anything that can call a Web fetch handler can run it. The App is the same on every platform; there are no adapter packages.

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

## Node and Bun

`server()` next to `composure()` builds the **Default Server** around your App (`src/app.tsx`, exported as `app`, or `composure({ app })`): no entry file to write.

```ts twoslash
import composure, { server } from "@composurejs/vite"
import { defineConfig } from "vite"
// ---cut---
export default defineConfig({
  plugins: [composure(), server()], // vite build → dist/index.js: node (or bun) dist/index.js
})
```

It listens on `PORT` (or 3000), passes `process.env` as the env, answers `GET /health` and caps bodies at 1 MiB. Background Work runs on tracked promises. On SIGTERM it stops accepting requests and waits up to 30 seconds for that work. It runs on Node and on Bun.

## Your own server

To change any of that, write the entry yourself and point `server({ entry })` at it. `@composurejs/vite/server` exports the pieces of the Default Server: `serve` with options, and `toRequest`/`send` to mount the App in a `node:http` server you already have.

```ts twoslash
// @filename: app.ts
import { App } from "composurejs"
export const app = new App()
// @filename: server.ts
// ---cut---
import { serve } from "@composurejs/vite/server"
import { app } from "./app.ts"

const server = await serve(app, { port: 8080, healthPath: "/healthz", shutdownGrace: 10_000 })
console.info({ msg: "Listening", url: server.url })
```

```ts twoslash
import composure, { server } from "@composurejs/vite"
import { defineConfig } from "vite"
// ---cut---
export default defineConfig({
  plugins: [composure(), server({ entry: "src/server.ts" })],
})
```

The entry can skip `@composurejs/vite/server` entirely and call `app.fetch` from anything that speaks Web `Request`/`Response`: `Bun.serve`, Deno, Hono, a serverless handler. Pass the env, and a platform with `waitUntil` if the host keeps running after the response; without one, Background Work finishes before the response is sent ([Deferring](./deferring)).

```ts twoslash
// @filename: app.ts
import { App } from "composurejs"
export const app = new App()
// @filename: bun.ts
declare const Bun: { serve(options: { port: number; fetch(request: Request): Promise<Response> }): unknown }
// ---cut---
import { createTracker } from "composurejs"
import { app } from "./app.ts"

const platform = createTracker() // waitUntil; platform.settle() on shutdown
Bun.serve({ port: 3000, fetch: (request) => app.fetch(request, process.env, platform) })
```

In `vite dev`, `server()` serves the App itself, so a custom entry applies to the build only. Drop `server()` altogether to build with another plugin.

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
