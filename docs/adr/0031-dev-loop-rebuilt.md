# The Dev Loop rebuilt: typed `dev` options, Tunnels that are ready, and an authoritative-DNS quick tunnel

Supersedes [ADR 0017](./0017-dev-loop.md). Amends [ADR 0024](./0024-default-server.md) (`serveInDev` moves into `server()`) and [ADR 0025](./0025-no-build-target.md) (`composure()`'s options).

The Dev Loop had grown one setting at a time: four `COMPOSURE_DEV_*` variables, a token variable, and `dev.*` options that each overrode a variable, with `tunnel`, `tunnelUrl`, `tunnelName` and `startTunnel` interacting by precedence. A quick tunnel often never got accepted by Discord. The plugin is rewritten around one typed shape, `composure({ app, dev: { application, guild, tunnel, transport } })`. Settings live only in the Vite config. A per-developer value is read there by the config itself (`loadEnv`), so the plugin reads no variable implicitly except secrets: `DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY` and `CLOUDFLARE_TUNNEL_TOKEN`. Without `dev` the Dev Loop is off, and under Vitest it stays off unless `dev.transport` is given. `dev.application` names the Dev Application, the only one ever repointed, and only when it is the token's. It is not a secret, and committing it records which application is the project's dev one. `dev.tunnel` is one discriminated value:
- `"quick"`, the default;
- `{ name, hostname }`, a named Cloudflare Tunnel the plugin runs. `hostname` is required because Vite freezes `allowedHosts` before cloudflared reports its routes, and the check that a dashboard route reaches Vite's port stays;
- `{ url }`, a tunnel the developer already runs;
- a function `(port) => Promise<Tunnel>`;
- `false`.

`dev.guild` turns dev Sync on, which is unchanged from 0017 and does not wait for the tunnel. Secrets live in `.env.local` for the Dev Application and `.env.production.local` for production. Both Vite and `@cloudflare/vite-plugin` read those files, and the Cloudflare plugin keys `.env.<name>` by Cloudflare environment, not Vite mode, so a `.env.development.local` would never reach the Worker in `vite dev`. `.env` and `.dev.vars` are not used, and the CLI stops reading `.dev.vars`. `create-composurejs` asks for the application and guild ids and writes them into `vite.config.ts`, or writes `dev: {}`.

The Dev Loop is three modules. A **Tunnel** resolves to `{ url, address?, close }` once it is connected. **Repoint** (first drafted as "Endpoint", renamed because the glossary's Endpoint is a REST route function) probes `<url>/interactions` until the App answers an unsigned POST with 401 (pinned to `address` when given), then PATCHes a field map on `/applications/@me`, so `event_webhooks_url` can be added later as one field. **dev Sync** runs independently. A timing spike (branch `prototype/quick-tunnel-readiness`, under `packages/vite/prototype/`) measured why quick tunnels failed. cloudflared prints the URL at about 3 s and registers a connection at about 4 s, and the authoritative nameservers have the A record 1 to 3 s later. Any lookup through a recursive resolver before that caches NXDOMAIN for 60 s. That applies to our own probe through the system resolver (as `untilReachable` did), to polling 1.1.1.1 (one run waited 64 s), and to Discord's resolver on each early PATCH. PATCHing every 3 s also drew 429s, and two of six runs were never accepted within 3 minutes. Waiting for the authoritative answer, then probing pinned to that IP, got the endpoint accepted on the first PATCH about 8 s after spawn in every run. The quick tunnel is therefore ready only after cloudflared's first registered connection, then an A record from the zone's authoritative nameservers (found with `resolveNs`, polled every second). Nothing resolves the hostname recursively before that. That knowledge belongs to the quick tunnel, so it lives there, and Repoint stays generic.

The PATCH waits `retry_after` on 429. On 400 it compares `DISCORD_PUBLIC_KEY` with the application's `verify_key` and fails on a mismatch; otherwise it retries once after 65 s and fails with the hint. Stages have their own limits: cloudflared connects in 30 s, DNS answers in 60 s, the probe gets a 401 in 30 s. Each stage logs one line, and a failure names its stage. The endpoint is not restored on exit. `untun` is dropped. cloudflared comes from `PATH` (or `CLOUDFLARED_PATH`), else a pinned release is downloaded to `node_modules/.cache/composurejs/` with Cloudflare's notice and checked against a per-platform SHA-256 table that a script bumps.

`composure()` and `server()` stay two plugins (0025). Hoisting, placement and the Handler Lock are carried over as they are. Tests drive `vite dev` on a temp project with a fake Tunnel and a recording transport, and the quick tunnel through an injected spawn, resolver and probe.

Rejected:
- Keeping env variables and options as two names for each setting.
- `allowedHosts: true` while tunnelling: it drops Vite's DNS-rebinding guard on a server that serves source.
- Requiring an installed cloudflared: it breaks clone → `pnpm dev`.
- The `cloudflared` npm package: its postinstall is blocked by pnpm 12.
- Trusting the download over HTTPS alone, as `untun` does.
- A fixed delay before the PATCH: it is either too short for the negative cache or slow every time.
- Merging `server()` back into `composure()`: that is 0025's rejected `target`.
