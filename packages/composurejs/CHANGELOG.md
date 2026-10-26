# composurejs

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

- [#1](https://github.com/BlueFrog130/composure-js/pull/1) [`5804aa3`](https://github.com/BlueFrog130/composure-js/commit/5804aa341d42f196f1a69352f3996e0ee71351f4) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - Auto Defer: a Command, click or modal submit whose handler has not answered 2 seconds after the
  request arrived is deferred for it, and the answer is edited in when it comes. `autoDefer: { after }`
  or `false` on the App; `autoDefer: false | "ephemeral"` on each Command.

- [#1](https://github.com/BlueFrog130/composure-js/pull/1) [`dc08fb5`](https://github.com/BlueFrog130/composure-js/commit/dc08fb5c8e2d105039fa0e11e5712bae9b5b8ee7) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - Forms: `form({ mood: field.radio(Mood, { label }), stars: field.integer({ label, min, max }) })` and
  `<Modal form={f} values={..} onSubmit={(c, v) => ..}>` render a modal from typed Fields and give
  `onSubmit` typed, parsed values. A select's `options` type `onSelect`'s values.
  `modalSubmit(..).users(..)` / `.roles(..)` in `composurejs/testing`; `res.submit()` finds inputs by name.

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

- [#1](https://github.com/BlueFrog130/composure-js/pull/1) [`58a0002`](https://github.com/BlueFrog130/composure-js/commit/58a00028fca68a9c1498fcf559df039b88b8b5e7) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - Localizations: `command`, `group`, `userCommand` and `messageCommand` take `localizations` by Discord
  locale (names, descriptions, Option names and descriptions, Choice names), checked when defined and
  published by Sync.

- [#1](https://github.com/BlueFrog130/composure-js/pull/1) [`0d1e0c9`](https://github.com/BlueFrog130/composure-js/commit/0d1e0c93add6466aa2e72b543f96dc5bdd0ff2a2) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - A click runs the middleware of the Command that rendered its handler (its Owning Route), so a guard
  on a nested App also guards that Command's buttons, and the buttons they render. The route travels
  in the `custom_id` (6 characters); a Command that no longer exists gets the Fallback. Also
  `Permission` flags, `c.can(...)` and `c.appCan(...)`, and `appPermissions()` on test builders.

- [#1](https://github.com/BlueFrog130/composure-js/pull/1) [`a8eae44`](https://github.com/BlueFrog130/composure-js/commit/a8eae4430fe6d55a1e2cafba601565960a0ebef6) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - Bots need Node 22.12+ (`server()` builds for `node22`). `composurejs` is a peer dependency of
  `@composurejs/vite` and `@composurejs/eslint-plugin`, so a bot has one copy. Autocomplete cuts
  over-long Choice names and drops invalid Choices instead of failing. `composurejs/testing`'s
  `command("name")` is now `chatInput("name")`, so it no longer clashes with `command` from core.

- [#1](https://github.com/BlueFrog130/composure-js/pull/1) [`d6e198f`](https://github.com/BlueFrog130/composure-js/commit/d6e198f7cb2821a3c0b3962a854c8b4f55df8dfd) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - REST requests time out after 10 s (`RequestTimeoutError`; `requestTimeout` on the App, `timeout` on
  a client), retry twice on network errors, timeouts and 5xx unless they are POSTs, and wait for a
  used-up rate limit bucket before sending instead of only reacting to 429s. `MockTransport` can
  `fail()` and `hang()`. The User-Agent names the package version.

- [#1](https://github.com/BlueFrog130/composure-js/pull/1) [`0f63de7`](https://github.com/BlueFrog130/composure-js/commit/0f63de772f7ce9a8a50f2e2013c3e8b63a5d9edc) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - Structured logging: everything logged while answering an Interaction (REST calls and Background
  Work included) carries `interactionId`, `interactionType`, `command` or `handler`, `guildId` and
  `userId`; handlers log through `c.log`. `createLogger({ level, format, fields })` replaces
  `consoleLogger`: `info` by default, `object` format on Workers, `pretty` elsewhere, `json` for log
  pipelines. `new App({ logger })` takes a Logger (pino's fits) or those options.
  `recordLogs()` in `composurejs/testing`.

### Patch Changes

- [#1](https://github.com/BlueFrog130/composure-js/pull/1) [`9b58ce3`](https://github.com/BlueFrog130/composure-js/commit/9b58ce321a174fa1f740429c6e7a3f2d1ba517e6) Thanks [@BlueFrog130](https://github.com/BlueFrog130)! - Core fixes from a review: a middleware that calls `next()` without awaiting it no longer leaves an
  unhandled rejection (fatal on Node); an App changed after a parent App was built is seen by the
  parent; `DiscordApiError` messages list Discord's per-field errors (`components[0].label: This field
  is required (BASE_TYPE_REQUIRED)`) and logged errors keep their own fields (`status`, `code`,
  `errors`); render errors about a `custom_id` name only its handler id, never its captured values.
