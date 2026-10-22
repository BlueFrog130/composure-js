# Deploying

## Build

`vite build`, with the plugin's `target`:

| Target | Output | Run |
|---|---|---|
| `cloudflare` (with `cloudflare()` from `@cloudflare/vite-plugin`) | a minified Worker and its `wrangler.json` in `dist/` | `wrangler deploy` |
| `node` | `dist/index.js`, self-contained: dependencies bundled | `node dist/index.js` |
| `bun` | `dist/index.js`, self-contained | `bun dist/index.js` |

```ts
// vite.config.ts for Workers
import { cloudflare } from "@cloudflare/vite-plugin"
import composure from "@composurejs/vite"
import { defineConfig } from "vite"

export default defineConfig({ plugins: [composure({ target: "cloudflare" }), cloudflare()] })
```

Set the production secrets on the platform (`wrangler secret put DISCORD_PUBLIC_KEY`, ...) and the application's Interactions Endpoint URL in the Developer Portal.

## Sync

Discord only shows Commands it has stored. `composure sync` (from `@composurejs/cli`) makes them match your App:

```sh
pnpm exec composure sync             # show the plan, ask, apply
pnpm exec composure sync --check     # CI: exit 2 when Discord is out of date
pnpm exec composure sync --yes       # CI deploy: apply without asking
```

It loads `src/app.tsx` (or `--app`) through Vite and compares each Command, by name and type, with what Discord stores, ignoring the defaults Discord fills in. It then shows a plan of creates, updates and deletes. Commands Discord has that your code doesn't are deleted. It needs `DISCORD_TOKEN` from the environment, `.env` files or `.dev.vars`.

### Scopes

Commands with `scope: "dev"` go to the guilds listed in `COMPOSURE_SCOPE_DEV=<id>,<id>` instead of globally. Every listed guild is synced, so removing a guild's last Command clears it; guilds no scope lists are never touched. `--guild <id>` sends every Command to one guild, to try a build out.
