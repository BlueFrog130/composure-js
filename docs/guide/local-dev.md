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
2. **Opens a tunnel.** A cloudflared quick tunnel (downloaded on first use) gives the server a public HTTPS URL. To use another tunnel, pass `dev: { startTunnel: async (port) => ({ url, close }) }` and add its hostname to Vite's `server.allowedHosts` (the plugin allows `.trycloudflare.com` for the quick tunnel).
3. **Points your dev application at it.** It sets the application's Interactions Endpoint URL to `<tunnel>/interactions`. Discord checks a new URL with a signed PING, which your server answers.
4. **Syncs Commands to your test server**, on start and after every save. Guild Commands update instantly.

It reads `.env` (and the process environment):

| Variable | |
|---|---|
| `DISCORD_PUBLIC_KEY`, `DISCORD_TOKEN` | the dev application's |
| `COMPOSURE_DEV_APPLICATION_ID` | turns the tunnel on, and lets it repoint **this** application |
| `COMPOSURE_DEV_GUILD` | turns dev Sync on, to this guild |

::: warning Use a separate dev application
The endpoint is only changed when `COMPOSURE_DEV_APPLICATION_ID` equals the token's application. A production token in `.env`, or a mismatch, never repoints anything; the URL to set by hand is printed instead.
:::

Tests never start any of this. Under Vitest the plugin compiles handlers but stays off Discord.
