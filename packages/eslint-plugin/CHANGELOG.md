# @composurejs/eslint-plugin

## 0.2.0

### Minor Changes

- [#21](https://github.com/BlueFrog130/composure-js/pull/21) [`11678d0`](https://github.com/BlueFrog130/composure-js/commit/11678d02195ed74292759d4ca8ed90c8d70cb667) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - The placement check follows function components: a tag passed to one is checked against the parent it puts its children in (`<Button> cannot go inside <Container> (in <ui.Primary>)`), and what one renders against where it is placed (`(rendered by <Card>)`). Function components are followed in the module and through relative imports and re-exports; `checkPlacement` takes `{ file, load }` for the latter. The lint rule reads imported modules from disk (`@composurejs/eslint-plugin` now depends on `oxc-parser`), and `vite dev` re-checks a module when one it followed changes.

### Patch Changes

- Updated dependencies [[`11678d0`](https://github.com/BlueFrog130/composure-js/commit/11678d02195ed74292759d4ca8ed90c8d70cb667), [`aaacd5e`](https://github.com/BlueFrog130/composure-js/commit/aaacd5e4ecf4c306ac38b006333cc93bf43d2987)]:
  - composurejs@0.2.0

## 0.1.3

### Patch Changes

- [#19](https://github.com/BlueFrog130/composure-js/pull/19) [`660677a`](https://github.com/BlueFrog130/composure-js/commit/660677af4df647f15f2ded5844adf95c9fcb47d6) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - Link the Discord server from the README.
- Updated dependencies [[`660677a`](https://github.com/BlueFrog130/composure-js/commit/660677af4df647f15f2ded5844adf95c9fcb47d6)]:
  - composurejs@0.1.3

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
