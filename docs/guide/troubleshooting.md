# Troubleshooting

**Discord says "This interaction failed".** Your bot answered with something Discord rejected, didn't answer within 3 seconds, or wasn't reached at all. Check the log: render errors (limits, placement) and handler errors are logged with what went wrong, tagged with the Interaction ([Logging](./logging)). For slow work, [defer](./deferring).

**The Interactions Endpoint URL won't save.** Discord sends a signed PING to a new URL first. The server must be running and reachable, and `DISCORD_PUBLIC_KEY` must be the public key of that same application. A wrong key gets 401.

**Commands don't show up.** Run `composure sync` (or set [`dev.guild`](./local-dev#options) while developing). Global Commands can take a while to appear in clients; guild Commands appear at once. Check `contexts` and `integrationTypes` if a Command is missing in DMs or in user installs.

**"This message is outdated."** The button's handler id no longer exists, or its values no longer decode. Usually the handler moved, was renamed, or now captures something different. Use [`named()`](./views#ids-deploys-and-named) for messages meant to last.

**`<Button onClick> got a function the build did not compile`.** Either the build didn't run the plugin (add `composure()` to `plugins` in `vite.config.ts`, and to `vitest.config.ts` for tests), or the function reached the prop some way the plugin cannot follow, such as stored in an object or returned from a component. Write handlers inline, at module scope or with `named()`, and pass handler props on unchanged ([Where a handler can come from](./views#where-a-handler-can-come-from)).

**`onClick={go}: go is a local variable`** or **`a handler made by a call cannot be hoisted`.** Write the function inline on the prop.

**`The handler in .. captures \`user\`, which is an object`.** Handlers carry their values in the button's `custom_id`. Capture `user.id` and load the rest inside the handler.

**`custom_id is 112 characters; the limit is 100`.** The captured values are too long. Capture an id and load the data in an async component or the handler.

**`<Local> is defined inside a function, but the onClick handler rendering it is hoisted to module scope`.** Move the component to module scope.

**`'File' cannot be used as a JSX component`** (or `Text`, `Option`). The tag is missing from your imports, so TypeScript found the DOM global of the same name. Import it from `composurejs`.

**`c.bot needs a bot token`.** Set `DISCORD_TOKEN`, or pass `credentials: { publicKey, token }` to the App.

**Rate limited.** Short waits are handled. `RateLimitedError` means Discord asked for longer than 2 seconds: slow down, or do the work in deferred or background work.

## The Dev Loop

`vite dev` logs one `[composure]` line per stage ([Local development](./local-dev#what-vite-dev-does)). A stage that fails logs `<stage> failed: ...` with what it last saw, and the server keeps running: fix the cause and restart `vite dev`.

**`Set the Interactions Endpoint URL by hand: ...`.** Nothing was repointed, and the line says why: `DISCORD_TOKEN is not set` (add it to `.env.local`), `dev.application is not set` (add your Dev Application's id to the config, or paste the URL into the Developer Portal), or `dev.application (...) is not the token's application (...)` (the token in `.env.local` belongs to another application, maybe production's: use the Dev Application's token, or fix the id).

**`cloudflared failed: ...`.** No cloudflared could be found or downloaded. `no release is pinned for <platform>`: install cloudflared, or set `CLOUDFLARED_PATH` to it. `downloading cloudflared from ... failed`: GitHub could not be reached; retry, or install it. `does not match its pinned SHA-256`: the download was not the pinned release, and was not kept; install cloudflared yourself and report it.

**`tunnel failed: no registered connection from cloudflared within 30s (last: ...)`.** The quick tunnel didn't connect. `last` is cloudflared's last log line: usually a network that blocks outbound connections to Cloudflare (port 7844), or trycloudflare.com refusing new tunnels for a while (`429 Too Many Requests`); wait a minute and restart. `cloudflared exited (...) before connecting` shows why it stopped. `cloudflared is not installed` means `CLOUDFLARED_PATH` names a missing file.

**`tunnel failed: no connection within 30s`.** A named tunnel, or your own tunnel function, didn't connect in 30 seconds. For a named tunnel, check that it exists and is not already run elsewhere with another configuration. `cloudflared tunnel token <name> failed (...)`: run `cloudflared tunnel login` once, or set `CLOUDFLARE_TUNNEL_TOKEN`.

**`tunnel <name> has no route for <host>`, `routes <host> to ..., but vite dev listens on http://localhost:<port>`.** A warning: the named tunnel's public hostnames in the Cloudflare dashboard don't send `hostname` to Vite. Change the route (Networks → Tunnels), or Vite's `server.port`.

**`dns failed: no A record for <host> from trycloudflare.com's nameservers within 60s (last: ...)`.** The quick tunnel connected, but its hostname was never published, or the nameservers could not be asked (`last` shows the DNS error, e.g. a network that blocks DNS to anything but its own resolver). Restart to get a new hostname, or use a [named tunnel](./local-dev#named-tunnel).

**`probe failed: no 401 from <url>/interactions within 30s (last: ...)`.** The tunnel is up, but the App didn't answer through it. `HTTP 403`: Vite's host check blocked the tunnel's host; with a tunnel function, add its host to `server.allowedHosts`. `HTTP 404`: nothing serves the App: add `server()` (Node, Bun) or `cloudflare()` (Workers) next to `composure()`. `HTTP 500`: the App failed to load or has no `DISCORD_PUBLIC_KEY` (check `.env.local`, and the terminal for the error). `HTTP 530`: Cloudflare cannot route the hostname to a running tunnel. `ECONNREFUSED`, `ETIMEDOUT`: the tunnel's address can't be reached from here.

**`rate limited; retrying in <n>s`.** Discord's rate limit on editing the application, usually after several restarts in a row. The plugin waits it out; nothing to do.

**`endpoint failed: DISCORD_PUBLIC_KEY is not the public key of application <id>`.** Discord's PING was rejected because the App verifies with another application's key. Copy the Dev Application's Public Key into `.env.local`.

**`Discord could not verify <url>; retrying once in 65s`**, then **`endpoint failed: ... The endpoint must answer Discord's signed PING`.** The key matches, but Discord could not reach the App or its PING got no valid answer. Check that requests through the tunnel reach this server (open the URL in a browser: `Method Not Allowed` means it does), and that nothing in front of the App changes the request.

**`endpoint failed: reading the token's application: ...`.** `DISCORD_TOKEN` was rejected (usually `401: Unauthorized`): reset the bot token in the Developer Portal and update `.env.local`.

**`dev Sync needs DISCORD_TOKEN (in .env.local).`, `dev Sync failed: ...`.** dev Sync couldn't run, or Discord rejected a Command definition; the message says which. The server keeps running, and the next save tries again.

## Something else?

The [decisions](/adr/0001-explicit-registration) explain why each part works the way it does. Issues are welcome on [GitHub](https://github.com/BlueFrog130/composure-js/issues).
