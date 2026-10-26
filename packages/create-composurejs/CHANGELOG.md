# create-composurejs

## 0.1.3

### Patch Changes

- [#19](https://github.com/BlueFrog130/composure-js/pull/19) [`660677a`](https://github.com/BlueFrog130/composure-js/commit/660677af4df647f15f2ded5844adf95c9fcb47d6) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - Link the Discord server from the README.

## 0.1.2

### Patch Changes

- [#17](https://github.com/BlueFrog130/composure-js/pull/17) [`46501eb`](https://github.com/BlueFrog130/composure-js/commit/46501ebcb154077b9ce362543ee0f925857c4efe) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - Add the logo to the README.

## 0.1.1

### Patch Changes

- [#13](https://github.com/BlueFrog130/composure-js/pull/13) [`a46d7ab`](https://github.com/BlueFrog130/composure-js/commit/a46d7ab4db89442b5ebd855aacc791fb949374e7) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - A README on each package's npm page, linking to the guide.

## 0.1.0

### Minor Changes

- [#11](https://github.com/BlueFrog130/composure-js/pull/11) [`e87dbf2`](https://github.com/BlueFrog130/composure-js/commit/e87dbf285430267ef06ecdae8a9861a3141b3e96) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - Asks for the Dev Application and dev guild ids (or `--application`/`--guild`) and writes them into `vite.config.ts` as `composure({ dev: { application, guild } })`, or `dev: {}` when skipped. Secrets go in `.env.local` (Dev Application) and `.env.production.local` (production, read by `pnpm start` and `pnpm sync`); `.dev.vars` and the `COMPOSURE_DEV_*` variables are gone.

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

- [#1](https://github.com/BlueFrog130/composure-js/pull/1) [`60dae81`](https://github.com/BlueFrog130/composure-js/commit/60dae814f24f6ad30ab3acc4470c7aad7ce44fa5) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - The Handler Lock: `vite build` writes `composure.handlers.json` (every handler id, where it is and
  what it captures) and warns when a change would drop one or change a `named()` handler's captures,
  turning buttons already sent into "This message is outdated."; with `CI` set it fails instead.
  `vite dev` warns as you edit. `composure({ handlerLock: false })` turns it off.
