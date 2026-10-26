# @composurejs/vite

## 0.1.2

### Patch Changes

- [#17](https://github.com/BlueFrog130/composure-js/pull/17) [`46501eb`](https://github.com/BlueFrog130/composure-js/commit/46501ebcb154077b9ce362543ee0f925857c4efe) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - Add the logo to the README.
- Updated dependencies [[`46501eb`](https://github.com/BlueFrog130/composure-js/commit/46501ebcb154077b9ce362543ee0f925857c4efe)]:
  - composurejs@0.1.2

## 0.1.1

### Patch Changes

- [#13](https://github.com/BlueFrog130/composure-js/pull/13) [`a46d7ab`](https://github.com/BlueFrog130/composure-js/commit/a46d7ab4db89442b5ebd855aacc791fb949374e7) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - A README on each package's npm page, linking to the guide.
- Updated dependencies [[`a46d7ab`](https://github.com/BlueFrog130/composure-js/commit/a46d7ab4db89442b5ebd855aacc791fb949374e7)]:
  - composurejs@0.1.1

## 0.1.0

### Minor Changes

- [#11](https://github.com/BlueFrog130/composure-js/pull/11) [`ca8b351`](https://github.com/BlueFrog130/composure-js/commit/ca8b351863c737e674046307ebe8f8c4df71645d) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - The Dev Loop can always find cloudflared: `CLOUDFLARED_PATH`, then `cloudflared` on `PATH`, else a pinned release for your platform, downloaded once into `node_modules/.cache/composurejs/` after showing Cloudflare's notice and rejected unless its SHA-256 matches the one pinned in the package.

- [#11](https://github.com/BlueFrog130/composure-js/pull/11) [`62901d3`](https://github.com/BlueFrog130/composure-js/commit/62901d3c189f52b70bf638d9154dde16b316eab1) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - The Dev Loop is configured in one typed option, `composure({ dev: { application, guild, tunnel } })`, and is off without `dev`. `application` names the Dev Application, the only one ever repointed, and only when `DISCORD_TOKEN` is its token (otherwise the URL to set by hand is printed); `guild` turns on dev Sync. `tunnel` is `"quick"` (the default), `{ name, hostname }` for a named Cloudflare Tunnel the plugin runs (token from `CLOUDFLARE_TUNNEL_TOKEN` or `cloudflared tunnel login`, with a warning when its route misses Vite's port), `{ url }` for a tunnel you already run, a function `(port) => Promise<Tunnel>`, or `false`; Vite's `server.allowedHosts` allows exactly that tunnel's host. Settings are never read from the environment: it holds only the secrets `DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY` and `CLOUDFLARE_TUNNEL_TOKEN`, the Dev Application's in `.env.local` and production's in `.env.production.local`; `vite dev` warns when `.env` sets `DISCORD_TOKEN`.
  
  The quick tunnel is accepted by Discord within seconds: it counts as ready once trycloudflare.com's authoritative nameservers publish its hostname, and nothing looks the hostname up before then, so no resolver (Discord's included) caches it as missing. The endpoint is set once the App answers through the tunnel; a 429 waits `retry_after`, and a rejected endpoint says whether `DISCORD_PUBLIC_KEY` is another application's. Each stage logs one line with the elapsed time and has its own limit (connect 30 s, DNS 60 s, probe 30 s); a failure names its stage without stopping `vite dev`. `untun` is no longer a dependency.

- [#1](https://github.com/BlueFrog130/composure-js/pull/1) [`60dae81`](https://github.com/BlueFrog130/composure-js/commit/60dae814f24f6ad30ab3acc4470c7aad7ce44fa5) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - The Handler Lock: `vite build` writes `composure.handlers.json` (every handler id, where it is and
  what it captures) and warns when a change would drop one or change a `named()` handler's captures,
  turning buttons already sent into "This message is outdated."; with `CI` set it fails instead.
  `vite dev` warns as you edit. `composure({ handlerLock: false })` turns it off.

- [#1](https://github.com/BlueFrog130/composure-js/pull/1) [`732f059`](https://github.com/BlueFrog130/composure-js/commit/732f0593034d2cbe45c059d93a370e90a7a24d29) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - `onClick` / `onSelect` / `onSubmit` accept more: each function branch of `?:`, `&&`, `||` and `??`
  is hoisted, a module-level or imported function becomes a handler, and wrapper components can pass a
  handler prop on (`({ onClick }) => <Button onClick={onClick} />`). Local variables and calls are
  compile errors, and render's error for an uncompiled function names both causes.

- [#1](https://github.com/BlueFrog130/composure-js/pull/1) [`3c36f46`](https://github.com/BlueFrog130/composure-js/commit/3c36f4662e1ced123d50853e9aecad692cdb6627) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - First release: Discord bots over HTTP Interactions on Cloudflare Workers, Node and Bun. Commands
  typed from their definitions, JSX messages checked against Discord's limits, Inline Handlers
  compiled by `@composurejs/vite`, deferred responses, a spec-checked REST client, Webhook Events,
  `composure sync`, the `vite dev` Dev Loop, placement checks at build time and in the editor
  (`@composurejs/eslint-plugin`, for ESLint and oxlint), and `pnpm create composurejs`. Workers
  serves `export default app`; for Node and Bun, `server()` builds the App into a Default Server
  (`@composurejs/vite/server`), or your own `entry`.

- [#1](https://github.com/BlueFrog130/composure-js/pull/1) [`a8eae44`](https://github.com/BlueFrog130/composure-js/commit/a8eae4430fe6d55a1e2cafba601565960a0ebef6) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - Bots need Node 22.12+ (`server()` builds for `node22`). `composurejs` is a peer dependency of
  `@composurejs/vite` and `@composurejs/eslint-plugin`, so a bot has one copy. Autocomplete cuts
  over-long Choice names and drops invalid Choices instead of failing. `composurejs/testing`'s
  `command("name")` is now `chatInput("name")`, so it no longer clashes with `command` from core.

### Patch Changes

- Updated dependencies [[`5804aa3`](https://github.com/BlueFrog130/composure-js/commit/5804aa341d42f196f1a69352f3996e0ee71351f4), [`9b58ce3`](https://github.com/BlueFrog130/composure-js/commit/9b58ce321a174fa1f740429c6e7a3f2d1ba517e6), [`dc08fb5`](https://github.com/BlueFrog130/composure-js/commit/dc08fb5c8e2d105039fa0e11e5712bae9b5b8ee7), [`732f059`](https://github.com/BlueFrog130/composure-js/commit/732f0593034d2cbe45c059d93a370e90a7a24d29), [`3c36f46`](https://github.com/BlueFrog130/composure-js/commit/3c36f4662e1ced123d50853e9aecad692cdb6627), [`58a0002`](https://github.com/BlueFrog130/composure-js/commit/58a00028fca68a9c1498fcf559df039b88b8b5e7), [`0d1e0c9`](https://github.com/BlueFrog130/composure-js/commit/0d1e0c93add6466aa2e72b543f96dc5bdd0ff2a2), [`a8eae44`](https://github.com/BlueFrog130/composure-js/commit/a8eae4430fe6d55a1e2cafba601565960a0ebef6), [`d6e198f`](https://github.com/BlueFrog130/composure-js/commit/d6e198f7cb2821a3c0b3962a854c8b4f55df8dfd), [`0f63de7`](https://github.com/BlueFrog130/composure-js/commit/0f63de772f7ce9a8a50f2e2013c3e8b63a5d9edc)]:
  - composurejs@0.1.0
