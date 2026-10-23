# Local development

`vite dev` is the whole loop: it serves the bot, makes it reachable from Discord, and keeps its Commands in sync while you edit.

```ts twoslash
import composure, { server } from "@composurejs/vite"
import { defineConfig } from "vite"
// ---cut---
// vite.config.ts (Node or Bun; for Workers, cloudflare() from @cloudflare/vite-plugin instead of server())
export default defineConfig({
  plugins: [composure({ dev: {} }), server()],
})
```

## What `vite dev` does

1. **Serves the bot.** With `server()`, Vite answers requests with your App (`src/app.tsx`, exported as `app`), loaded through Vite: an edit takes effect on the next Interaction, without a restart. For Workers, `@cloudflare/vite-plugin` runs the Worker on workerd.
2. **Opens a tunnel** (`dev.tunnel`): a cloudflared quick tunnel by default (`"quick"`), your named Cloudflare Tunnel (`{ name, hostname }`, run by the plugin with `CLOUDFLARE_TUNNEL_TOKEN` or after `cloudflared tunnel login`; it warns when the tunnel's route for that hostname doesn't go to Vite's port), a tunnel you already run (`{ url }`), your own function `(port) => Promise<Tunnel>` (add its host to Vite's `server.allowedHosts`), or none (`false`).
3. **Points your Dev Application at it** (`dev.application`). It waits until the App answers through the tunnel, then sets the application's Interactions Endpoint URL to `<tunnel>/interactions`. A 429 waits `retry_after`; when Discord can't verify the URL, the log says whether `DISCORD_PUBLIC_KEY` belongs to another application, and otherwise retries once after 65 s. Each stage logs one line, and a failure names its stage.
4. **Syncs Commands to your test server** (`dev.guild`), on start and after every save. Guild Commands update instantly.

Without `dev` none of this runs. Settings live only in the Vite config; the environment (Vite's env files for the mode, then the process environment) holds only secrets:

| Variable | |
|---|---|
| `DISCORD_PUBLIC_KEY`, `DISCORD_TOKEN` | the Dev Application's |
| `CLOUDFLARE_TUNNEL_TOKEN` | optional: a named tunnel's token, instead of `cloudflared tunnel login` |

```ts twoslash
import composure from "@composurejs/vite"
import { defineConfig } from "vite"
// ---cut---
export default defineConfig({
  plugins: [
    composure({
      dev: {
        application: "1100146565504565411", // the Dev Application
        guild: "798662131062931547", // dev Sync's guild
        tunnel: { name: "bot-dev", hostname: "bot-dev.example.com" }, // default: "quick"
      },
    }),
  ],
})
```

::: warning Use a separate dev application
The endpoint is only changed when `dev.application` is the token's application. A production token, or a mismatch, never repoints anything; the URL to set by hand is printed instead.
:::

Tests never start any of this. Under Vitest the plugin compiles handlers but stays off Discord, unless `dev.transport` (tests only) is given.
