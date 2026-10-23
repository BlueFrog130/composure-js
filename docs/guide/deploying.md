# Deploying

## Build

`vite build`. `composure()` compiles Inline Handlers; the plugin next to it decides the output:

| Plugins | Output | Run |
|---|---|---|
| `composure(), cloudflare()` (from `@cloudflare/vite-plugin`) | a Worker and its `wrangler.json` in `dist/` | `wrangler deploy` |
| `composure(), server()` | `dist/index.js`, the [Default Server](./platforms#node-and-bun) or your `entry`, self-contained: dependencies bundled | `node dist/index.js` or `bun dist/index.js` |

```ts
// vite.config.ts for Workers
import { cloudflare } from "@cloudflare/vite-plugin"
import composure from "@composurejs/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [composure(), cloudflare()],
  build: { minify: true }, // bundle size is cold-start time on Workers
})
```

### The Handler Lock

`vite build` writes `composure.handlers.json` next to your config: every handler id the bot ships, where it is and what it captures. Commit it. When a change would drop an id, or change what a `named()` handler captures, buttons already sent with it would answer "This message is outdated.", so:

- a local `vite build` warns, naming each handler, and updates the file, which then shows the removal in review;
- with `CI` set, `vite build` fails instead and writes nothing. If the change is intended, build locally and commit the updated file; to keep the buttons working, give the handler a fixed id with [`named()`](./views#ids-deploys-and-named).

`vite dev` warns as you edit. `composure({ handlerLock: false })` turns it off.

Set the production secrets on the platform (`wrangler secret put DISCORD_PUBLIC_KEY`, ...) and the application's Interactions Endpoint URL in the Developer Portal.

## Sync

Discord only shows Commands it has stored. `composure sync` (from `@composurejs/cli`) makes them match your App:

```sh
pnpm exec composure sync             # show the plan, ask, apply
pnpm exec composure sync --check     # CI: exit 2 when Discord is out of date
pnpm exec composure sync --yes       # CI deploy: apply without asking
```

It loads `src/app.tsx` (or `--app`) through Vite and compares each Command, by name and type, with what Discord stores, ignoring the defaults Discord fills in. It then shows a plan of creates, updates and deletes. Commands Discord has that your code doesn't are deleted. It needs `DISCORD_TOKEN`: production's, from the environment or `.env.production.local`, which wins over `.env.local` in production mode, the default. `--mode development` skips `.env.production.local`, so it syncs with the Dev Application's token from `.env.local`. In production mode, when `DISCORD_TOKEN` is set in neither the environment nor `.env.production.local`, the one from `.env.local` is used, with a warning.

### Scopes

Commands with `scope: "dev"` go to the guilds listed in `COMPOSURE_SCOPE_DEV=<id>,<id>` instead of globally. Every listed guild is synced, so removing a guild's last Command clears it; guilds no scope lists are never touched. `--guild <id>` sends every Command to one guild, to try a build out.
