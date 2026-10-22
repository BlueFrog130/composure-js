# CLAUDE.md

composurejs: TypeScript framework for HTTP-interaction-only Discord bots on any fetch runtime. Port of the ideas of composure-rs (github.com/BlueFrog130/composure-rs); when unsure of behavior, check what it does and its ADR.

## Commands

```sh
pnpm install
pnpm test                      # pnpm build, then vitest projects: packages/*, examples/*
pnpm vitest run -t "signed fixtures"   # one test by name (run pnpm build once first for examples/)
pnpm typecheck                 # per package; composurejs also runs tsconfig.core.json (no Node types)
pnpm build                     # tsdown (declarations from tsconfig.build.json: src only)
pnpm -C examples/bot build     # vite build → Worker in dist/ (minified); build:node / build:bun → dist/node, dist/bun
pnpm size                      # builds examples/bot, then size-limit (.size-limit.json): CI fails past a limit
pnpm -C examples/bot coldstart # workerd cold start vs. an empty Worker (report only)
pnpm -C docs dev               # the guide; `pnpm -C docs build` type-checks every ```ts twoslash snippet (after pnpm build)
pnpm -C examples/bot dev       # vite dev on workerd; needs DISCORD_PUBLIC_KEY in examples/bot/.dev.vars
```

The example's Vite configs import the built `@composurejs/vite` (dist), as a bot would; its Vitest config imports the plugin's source. `examples/bot/test/build.test.ts` runs the real `vite build` for each target and drives the output (Node/Bun processes, the Worker in Miniflare, which must match wrangler's version); it skips Bun when `bun` is not on PATH.

REST: `spec/openapi.json` is Discord's spec at the commit in `spec/PINNED`; `node packages/composurejs/scripts/update-spec.mjs [sha]` refreshes it and regenerates `src/rest/schema.d.ts` (via TypeScript 5.9 in `pnpm dlx`; openapi-typescript cannot run on TypeScript 7). A new Endpoint goes in `ROUTES` with the spec's exact path and operationId; `PRINT_UNIMPLEMENTED=1 pnpm vitest run rest-spec` lists the rest.

Releases: Changesets (`pnpm changeset` for any change to composurejs, @composurejs/adapter-*, @composurejs/vite, @composurejs/cli, create-composurejs; never bump versions by hand). `.github/workflows/release.yml` opens the Version Packages PR and publishes on merge (NPM_TOKEN). Packages ship `dist` + LICENSE (copied in `prepack`).

Use pnpm only. pnpm 12 blocks dependency build scripts unless they're listed in `allowBuilds` in `pnpm-workspace.yaml`.

## Layout

- `packages/composurejs/src`: `app.ts` (App builder, tree build/checks, Credentials/Bot Data loaders cached per isolate), `pipeline.ts` (verify → parse → Ping → dispatch → render/Error Renderer; `handleInteraction`), `context.ts` (`c`), `command.ts` (command/group/userCommand/messageCommand + definitions), `options.ts` (Option builders, value inference, resolution, rule checks), `middleware.ts` (`runChain`), `factory.ts` (`createFactory<Env>()`), `response.ts` (Output → InteractionResponse), `verify.ts` (WebCrypto Ed25519, key cached per isolate), `jsx/` (node tree + the one render/validation walk; `LIMITS`), `components.ts` (built-in tags; their props' TSDoc is the tag reference; `upload`, `md`), `transport.ts` (Transport, multipart), `codec.ts` (custom_id fields, escaping, self-describing Captures), `handlers.ts` (the handler registry: `__handler` (written by the plugin), `named`, dispatch by Handler Id, modal values by input `name`), `tracker.ts` (Tracker: Background Work for the server Adapters), `events.ts` (Webhook Events: decode, EventContext), `sync.ts` (`composurejs/sync`: config from env, targets, plan/normalize, apply, formatPlan; ADR 0016; used by the CLI and the Dev Loop), `rest/` (`client.ts` RestClient/BotClient and op-typed `RequestBody`/`ResponseBody`/`Query`, `endpoints.ts` Tier 1 functions + `ROUTES`, `interaction.ts` Interaction Client, `message.ts` View → body, `schema.d.ts` generated: never edit), `testing/` (TestKey, builders, `answer`, TestPlatform, MockTransport; `answer` uses a fresh MockTransport by default so tests never reach Discord, and `test-bot-token` as the bot token; `res.settle()` runs Background Work and returns the REST requests; `sendEvent` delivers Webhook Events).
- `packages/adapter-<platform>` (`@composurejs/adapter-cloudflare`, `-node`, `-bun`; ADR 0022): one `src/index.ts` each, depending on `composurejs`. node and bun each keep a copy of `shutdown.ts`; change both. `test/regression.test.ts` replays core's signed fixtures over the Adapter via `../../composurejs/test/replay.ts`.
- `packages/cli/src`: `load.ts` (loads the App via Vite `runnerImport` + the plugin), `cli.ts` (commander program; `main(argv, io)` returns the exit status), `ui.ts` (`Ui`: `@clack/prompts` in a terminal, `recordingUi` in tests), `bin.ts` (the `composure` executable). `test/cli.test.ts` runs it against examples/bot with a MockTransport.
- `packages/create-composurejs/src`: `templates.ts` (`generate(template, name, versions)`: every file of a new bot, one source for cloudflare/node/bun), `create.ts` (commander + clack; `main(argv, env)`), `bin.ts` (bundles the sibling packages' versions at build). `node scripts/check-templates.mjs [template..]` (after `pnpm build`) generates each into `.tmp/templates/`, links the workspace packages, and runs install, typecheck, test, build; CI runs it. Change a template there, never by hand in a generated copy.
- `packages/vite/src/dev.ts`: the Dev Loop (ADR 0017): serves the App for node/bun in `vite dev`, tunnel (untun or `dev.startTunnel`), PATCHes the dev application only when `COMPOSURE_DEV_APPLICATION_ID` matches the token's, dev Sync to `COMPOSURE_DEV_GUILD`. Runs only when the plugin has a `target` (never under the example's Vitest). `test/dev.test.ts` drives a real dev server on a temp project in `test/.tmp/` with a recording transport.
- `packages/vite/src/index.ts`: the plugin: build targets (`node`/`bun` SSR bundle; `cloudflare` defers to `@cloudflare/vite-plugin` and minifies; ADR 0014) and the hoisting transform.
- `packages/vite/src/transform.ts`: Inline Handler hoisting (oxc-parser + magic-string, `enforce: "pre"`): every `onClick`/`onSelect`/`onSubmit` function and `named()` call in any module becomes `const __composure_hN = __handler(id, captures, make, where)` after the imports, its site `__composure_hN.bind([..])`. That call is the contract with `handlers.ts`; change both together. Vite is required (ADR 0015): there is no un-compiled API. Vitest configs import the plugin from workspace source, so tests run through it; `test/handlers.test.tsx` imports from `../src/*.ts` by path to get un-compiled code.
- Workspace packages resolve to `src` through the `@composurejs/source` export condition (tsconfig `customConditions`, vitest `ssr.resolve.conditions`). Published consumers get `dist`.
- `test/fixtures.tsx`: signed regression fixtures (fixed seed), replayed over `app.fetch` (`test/regression.test.ts`) and over every Adapter (`replayFixtures` in `test/replay.ts`, called from each Adapter package). Add a case for every new Interaction shape.

## Rules

- Docs: `docs/guide/*.md`, one chapter per topic; code blocks that show API use ```ts twoslash / ```tsx twoslash so a type error fails the docs build (`// ---cut---` hides setup, `// @filename:` splits files). docs pins TypeScript 5.9 because twoslash needs the TypeScript 5 compiler API. Update the chapter when an API changes.

- Core (all of `packages/composurejs/src`) must not use Node APIs or types. `tsconfig.core.json` enforces it; so does adapter-cloudflare's `tsconfig.build.json`.
- Zero runtime dependencies. `discord-api-types` is imported with `import type` only, so its enums are restated in `src/discord.ts`.
- Logs are structured objects. Never log the interaction token, a URL containing it, or Custom ID State.
- Unknown Discord data (interaction types, component types, events) is answered or passed through. It must never throw.
- Use the words in `CONTEXT.md`. Record decisions as `docs/adr/NNNN-*.md`: one dense paragraph or a few, saying what was decided and why, plus the alternatives that were rejected.
