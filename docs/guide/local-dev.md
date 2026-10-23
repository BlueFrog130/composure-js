# Local development

`vite dev` is the whole loop: it serves the bot, makes it reachable from Discord, and keeps its Commands in sync while you edit.

```ts twoslash
import composure, { server } from "@composurejs/vite"
import { defineConfig } from "vite"
// ---cut---
// vite.config.ts (Node or Bun; for Workers, cloudflare() from @cloudflare/vite-plugin instead of server())
export default defineConfig({
  plugins: [composure(), server()],
})
```

## What `vite dev` does

1. **Serves the bot.** With `server()`, Vite answers requests with your App (`src/app.tsx`, exported as `app`), loaded through Vite: an edit takes effect on the next Interaction, without a restart. For Workers, `@cloudflare/vite-plugin` runs the Worker on workerd.
2. **Opens a tunnel.** A cloudflared quick tunnel (downloaded on first use) gives the server a public HTTPS URL. If you run your own tunnel to `vite dev` (a named Cloudflare Tunnel, an ngrok domain), set `COMPOSURE_DEV_TUNNEL_URL` to its URL instead, in your own `.env.local`: no quick tunnel is opened and its host is allowed. Teammates without one keep the quick tunnel. A tunnel started from code goes in `dev: { startTunnel: async (port) => ({ url, close }) }`; add its hostname to Vite's `server.allowedHosts`.
3. **Points your dev application at it.** It waits until the tunnel reaches the server, then sets the application's Interactions Endpoint URL to `<tunnel>/interactions`, retrying for a minute while Discord can't verify it yet. Discord checks a new URL with a signed PING, which your server answers; if it never verifies, the log says whether `DISCORD_PUBLIC_KEY` belongs to another application.
4. **Syncs Commands to your test server**, on start and after every save. Guild Commands update instantly.

It reads `.env` (and the process environment):

| Variable | |
|---|---|
| `DISCORD_PUBLIC_KEY`, `DISCORD_TOKEN` | the dev application's |
| `COMPOSURE_DEV_APPLICATION_ID` | turns the tunnel on, and lets it repoint **this** application |
| `COMPOSURE_DEV_GUILD` | turns dev Sync on, to this guild |
| `COMPOSURE_DEV_TUNNEL_URL` | optional: your own tunnel's public URL, used instead of a quick tunnel |

The same settings can go in the Vite config, where they win over the environment. The token stays in `.env`:

```ts twoslash
import composure from "@composurejs/vite"
import { defineConfig } from "vite"
// ---cut---
export default defineConfig({
  plugins: [
    composure({
      dev: {
        applicationId: "1100146565504565411", // the dev application
        guild: "798662131062931547", // dev Sync's guild
        tunnelUrl: process.env.MY_TUNNEL, // your own tunnel; unset: a quick tunnel
      },
    }),
  ],
})
```

::: warning Use a separate dev application
The endpoint is only changed when `COMPOSURE_DEV_APPLICATION_ID` equals the token's application. A production token in `.env`, or a mismatch, never repoints anything; the URL to set by hand is printed instead.
:::

Tests never start any of this. Under Vitest the plugin compiles handlers but stays off Discord.
