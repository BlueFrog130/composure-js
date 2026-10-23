# @composurejs/vite

[![npm](https://img.shields.io/npm/v/@composurejs/vite?color=5865f2)](https://www.npmjs.com/package/@composurejs/vite)
[![Guide](https://img.shields.io/badge/docs-guide-5865f2)](https://bluefrog130.github.io/composure-js/)
[![License](https://img.shields.io/npm/l/@composurejs/vite?color=blue)](https://github.com/BlueFrog130/composure-js/blob/main/LICENSE)

The Vite plugin for [composurejs](https://www.npmjs.com/package/composurejs). It compiles inline handlers, builds your bot for Cloudflare Workers, Node or Bun, and runs the dev loop.

```sh
pnpm add -D @composurejs/vite vite
```

## Cloudflare Workers

```ts
// vite.config.ts
import { cloudflare } from "@cloudflare/vite-plugin"
import composure from "@composurejs/vite"
import { defineConfig } from "vite"

export default defineConfig({ plugins: [composure(), cloudflare()] })
```

## Node and Bun

```ts
import composure, { server } from "@composurejs/vite"
import { defineConfig } from "vite"

export default defineConfig({ plugins: [composure(), server()] })
```

`vite build` writes one self-contained `dist/index.js` that serves your App. Pass `server({ entry: "src/server.ts" })` to wrap it in your own server instead.

## The dev loop

```ts
composure({ dev: { application: "<dev application id>", guild: "<test server id>" } })
```

With `DISCORD_TOKEN` and `DISCORD_PUBLIC_KEY` in `.env.local`, `vite dev`:

1. serves the bot and opens a Cloudflare tunnel to it (a quick tunnel by default, or your own named one),
2. points your dev application's Interactions Endpoint URL at the tunnel,
3. syncs your Commands to the test server, and again on every save that changes them.

It only ever repoints the application you name, so production is never touched. If `cloudflared` isn't installed, a pinned, checksum-verified release is downloaded once.

## Inline handlers

`onClick`, `onSelect` and `onSubmit` take a plain function. The plugin hoists each one and stores what it captures in the component's `custom_id`. Builds record their handlers in `composure.handlers.json` (the Handler Lock), and CI fails a build that would break buttons already sent to Discord.

Guide: [Local development](https://bluefrog130.github.io/composure-js/guide/local-dev) · [Deploying](https://bluefrog130.github.io/composure-js/guide/deploying) · [Platforms](https://bluefrog130.github.io/composure-js/guide/platforms)
