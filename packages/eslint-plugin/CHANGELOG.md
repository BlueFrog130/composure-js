# @composurejs/eslint-plugin

## 0.1.0

### Minor Changes

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
