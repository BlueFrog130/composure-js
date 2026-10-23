# Local development

`vite dev` is the whole loop: it serves the bot, makes it reachable from Discord, points your development application at it, and keeps its Commands in sync while you edit. All of it is configured in one place, the `dev` option of `composure()`:

```ts twoslash
import composure, { server } from "@composurejs/vite"
import { defineConfig } from "vite"
// ---cut---
// vite.config.ts (Node or Bun; for Workers, cloudflare() from @cloudflare/vite-plugin instead of server())
export default defineConfig({
  plugins: [
    composure({
      dev: {
        application: "1100146565504565411", // your Dev Application
        guild: "798662131062931547", // your test server
      },
    }),
    server(),
  ],
})
```

Then put that application's secrets in `.env.local` and run `vite dev` (`pnpm dev` in a new bot).

## What `vite dev` does

1. **Serves the bot.** With `server()`, Vite answers requests with your App (`src/app.tsx`, exported as `app`), loaded through Vite: an edit takes effect on the next Interaction, without a restart. For Workers, `@cloudflare/vite-plugin` runs the Worker on workerd.
2. **Opens a [Tunnel](#tunnels)**, a public HTTPS URL that forwards to Vite. By default a cloudflared quick tunnel, which needs no account.
3. **Points your Dev Application at it.** It waits until the App answers through the tunnel (an unsigned POST to `<tunnel>/interactions` gets a 401), then sets the application's Interactions Endpoint URL to that address. Discord sends a signed PING to a new URL before it accepts it, so the App must already be answering.
4. **Syncs Commands to your test server**, on start and after every save. Guild Commands update instantly, and nothing is sent when the Commands haven't changed. This doesn't wait for the tunnel.

Each stage logs one line as it finishes:

```txt
[composure] dev Sync to guild 798662131062931547: 2 to create, 0 to update, 0 to delete
[composure] tunnel connected https://example-words-here.trycloudflare.com (6.2s)
[composure] https://example-words-here.trycloudflare.com/interactions answers through the tunnel (6.9s)
[composure] Dev Application 1100146565504565411 → https://example-words-here.trycloudflare.com/interactions (8.1s)
```

A stage that fails logs `<stage> failed: ...` with the last thing it saw, and `vite dev` keeps running. [Troubleshooting](./troubleshooting#the-dev-loop) lists each message. The endpoint is left pointing at the tunnel when you stop, and the tunnel closes with the server.

Without `dev` none of this runs: the plugin only compiles handlers, and `vite dev` only serves the bot.

## Options

| `dev.` | | Unset |
|---|---|---|
| `application` | Your Dev Application's id (General Information → Application ID). The only application whose endpoint is ever changed, and only when `DISCORD_TOKEN` is its token. | The tunnel opens and the URL to paste into the Developer Portal is printed. |
| `guild` | The test server Commands are synced to (Developer Mode → right-click the server → Copy Server ID). | No dev Sync. |
| `tunnel` | Which [Tunnel](#tunnels) to open. | `"quick"` |
| `transport` | Tests only: where REST requests to Discord go. | Discord. |

Neither id is a secret: commit them, so everyone on the project develops against the same application. Each setting has only this one name. Nothing in `dev` is read from the environment.

::: warning Use a separate Dev Application
Create an application for development and keep it apart from the one you deploy. The endpoint is only changed when `dev.application` is the token's application, so a production token in your env, or a typo, never repoints production: the URL to set by hand is printed instead.
:::

If each developer has their own Dev Application, read the ids in the config yourself with Vite's `loadEnv`:

```ts twoslash
import composure from "@composurejs/vite"
import { defineConfig, loadEnv } from "vite"
// ---cut---
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  return { plugins: [composure({ dev: { application: env.MY_DEV_APPLICATION, guild: env.MY_DEV_GUILD } })] }
})
```

## Tunnels

`dev.tunnel` picks one:

| `dev.tunnel` | What opens | Vite allows |
|---|---|---|
| `"quick"` (default) | A cloudflared quick tunnel on a random `trycloudflare.com` hostname. No account needed. | `.trycloudflare.com` |
| `{ name, hostname }` | Your named Cloudflare Tunnel, run by the plugin: a stable URL on your own domain. | `hostname` |
| `{ url }` | A tunnel you already run (ngrok, ...), forwarding to Vite's port. Only the endpoint is repointed. | `url`'s host |
| `(port) => Promise<Tunnel>` | Anything else: your function opens it. | nothing: [add it yourself](#your-own-tunnel) |
| `false` | No tunnel, and no repointing. Commands are still synced. | |

Vite's host check (`server.allowedHosts`) blocks requests whose `Host` it doesn't know, which guards the dev server against DNS rebinding. The plugin allows exactly the tunnel's host and nothing more.

### cloudflared

The quick and named tunnels run [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). The plugin uses `CLOUDFLARED_PATH` when set, else `cloudflared` on your `PATH`. With neither, it downloads the cloudflared release pinned in `@composurejs/vite` for your platform into `node_modules/.cache/composurejs/`, once, after printing Cloudflare's notice, and keeps it only if its SHA-256 matches the one pinned in the package.

### Quick tunnel

The default. Its hostname is new each run, so the plugin repoints the Dev Application every time you start `vite dev`. The tunnel counts as ready once cloudflared has registered a connection and `trycloudflare.com`'s own nameservers publish the hostname, usually a few seconds after start. Until then nothing looks the hostname up through an ordinary resolver: a lookup that early would cache "no such host" for a minute, at Discord too, and Discord would refuse the endpoint.

### Named tunnel

For a URL that doesn't change, create a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/) on your domain with a public hostname routed to `http://localhost:5173` (Vite's port), then:

```ts twoslash
import composure from "@composurejs/vite"
// ---cut---
composure({ dev: { application: "1100146565504565411", tunnel: { name: "bot-dev", hostname: "bot-dev.example.com" } } })
```

The plugin runs `cloudflared tunnel run` with the tunnel's token, which it reads from `CLOUDFLARE_TUNNEL_TOKEN` (the tunnel's install command in the Cloudflare dashboard shows it), or else fetches with `cloudflared tunnel token bot-dev` after a one-time `cloudflared tunnel login`. The token goes to cloudflared through its environment, never on the command line. The tunnel is ready at its first registered connection. When the tunnel's routes send `hostname` somewhere other than Vite's port, a warning names the route.

### A tunnel you already run

```ts twoslash
import composure from "@composurejs/vite"
// ---cut---
composure({ dev: { application: "1100146565504565411", tunnel: { url: "https://my-bot.ngrok.app" } } })
```

Start it yourself, forwarding to Vite's port. The plugin doesn't open or close it; it only points the Dev Application at `<url>/interactions`.

### Your own tunnel

A function gets Vite's port and resolves to a `Tunnel` once it is connected: its `url`, a `close()` the plugin calls when the server stops, and optionally `address`, an IP the URL's host is known to resolve to (the readiness probe connects there instead of looking the host up). The plugin can't know the host before your function runs, so add it to `server.allowedHosts` yourself, or Vite answers every request through the tunnel with 403:

```ts twoslash
import composure, { type Tunnel } from "@composurejs/vite"
import { defineConfig } from "vite"
declare function startMyTunnel(port: number): Promise<{ url: string; stop(): Promise<void> }>
// ---cut---
export default defineConfig({
  server: { allowedHosts: [".my-tunnels.example"] },
  plugins: [
    composure({
      dev: {
        application: "1100146565504565411",
        tunnel: async (port): Promise<Tunnel> => {
          const t = await startMyTunnel(port)
          return { url: t.url, close: () => t.stop() }
        },
      },
    }),
  ],
})
```

It must connect within 30 seconds.

## Env files

The environment holds only secrets, in two files next to `vite.config.ts`, both gitignored:

| File | Holds | Read by |
|---|---|---|
| `.env.local` | the Dev Application's secrets | `vite dev` (Vite, and the Worker on workerd), `composure sync --mode development` |
| `.env.production.local` | production's secrets | `composure sync` (production mode, the default), where it wins over `.env.local`. Never `vite dev`. |

| Variable | |
|---|---|
| `DISCORD_PUBLIC_KEY` | General Information → Public Key. The App verifies Interactions with it. |
| `DISCORD_TOKEN` | Bot → Token. For `c.bot`, repointing the endpoint and dev Sync. |
| `CLOUDFLARE_TUNNEL_TOKEN` | Optional: a named tunnel's token, instead of `cloudflared tunnel login`. |

For the plugin and the CLI, variables already set in the process environment win over both files. Production's secrets never sit in a file `vite dev` loads, so a dev server can't act on production. For a deployed Worker, set them with `wrangler secret put` instead ([Deploying](./deploying)).

Vite also reads `.env` and `.env.[mode]`, but don't put secrets there: `.env` is loaded in every mode, and `@cloudflare/vite-plugin` picks `.env.<name>` files by Cloudflare environment rather than Vite mode, so `.env.local` is the one per-developer file the Worker sees in `vite dev`.

## Tests

Tests never start any of this. Under Vitest the plugin compiles handlers but the Dev Loop stays off, unless `dev.transport` is given, so a test run never reaches Discord with your real token.
