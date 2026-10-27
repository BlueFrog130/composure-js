# CLAUDE.md

composurejs: TypeScript framework for HTTP-interaction-only Discord bots on any fetch runtime. Port of the ideas of composure-rs (github.com/BlueFrog130/composure-rs); when unsure of behavior, check what it does and its ADR.

## Commands

```sh
pnpm install
pnpm test                      # pnpm build, then vitest projects: packages/*, examples/*
pnpm vitest run -t "signed fixtures"   # one test by name (run pnpm build once first for examples/)
pnpm typecheck                 # per package; composurejs also runs tsconfig.core.json (no Node types)
pnpm lint                      # oxlint (.oxlintrc.json)
pnpm fmt                       # oxfmt (.oxfmtrc.json); CI runs pnpm fmt:check. Markdown is not formatted
pnpm build                     # tsdown (declarations from tsconfig.build.json: src only)
pnpm -C examples/bot build     # vite build → Worker in dist/ (minified)
pnpm size                      # builds examples/bot, then size-limit (.size-limit.json): CI fails past a limit
pnpm -C examples/bot coldstart # workerd cold start vs. an empty Worker (report only)
pnpm -C docs dev               # the guide; `pnpm -C docs build` type-checks every ```ts twoslash snippet (after pnpm build)
pnpm -C examples/bot dev       # vite dev on workerd; needs DISCORD_PUBLIC_KEY in examples/bot/.env.local
pnpm vitest run --project bot  # composurejs's own bot (bots/composure); its build test needs pnpm build first
```

The example's Vite configs import the built `@composurejs/vite` (dist), as a bot would; its Vitest config imports the plugin's source. `examples/bot/test/build.test.ts` runs the real `vite build` (the Worker, and `[composure(), server()]` through Vite's `build()` into `dist/server`) and drives the output (Node/Bun processes, the Worker in Miniflare, which must match wrangler's version); it skips Bun when `bun` is not on PATH.

REST: `spec/openapi.json` is Discord's spec at the commit in `spec/PINNED`; `node packages/composurejs/scripts/update-spec.mjs [sha]` refreshes it and regenerates `src/rest/schema.d.ts` (via TypeScript 5.9 in `pnpm dlx`; openapi-typescript cannot run on TypeScript 7). A new Endpoint goes in `ROUTES` with the spec's exact path and operationId; `PRINT_UNIMPLEMENTED=1 pnpm vitest run rest-spec` lists the rest.

Releases: Changesets (`pnpm changeset` for any change to composurejs, @composurejs/vite, @composurejs/cli, @composurejs/eslint-plugin, create-composurejs; never bump versions by hand). `.github/workflows/release.yml` opens the Version Packages PR and publishes on merge (NPM_TOKEN). Packages ship `dist` + LICENSE (copied in `prepack`).

Use pnpm only. pnpm 12 blocks dependency build scripts unless they're listed in `allowBuilds` in `pnpm-workspace.yaml`.

## Layout

- `packages/composurejs/src`: `app.ts` (App builder, tree build/checks, Credentials/Bot Data loaders cached per isolate), `pipeline.ts` (verify → parse → Ping → dispatch → render/Error Renderer; `handleInteraction`), `context.ts` (`c`), `command.ts` (command/group/userCommand/messageCommand + definitions), `options.ts` (Option builders, value inference, resolution, rule checks), `middleware.ts` (`runChain`), `factory.ts` (`createFactory<Env>()`), `response.ts` (Output → InteractionResponse), `verify.ts` (WebCrypto Ed25519, key cached per isolate), `jsx/` (node tree + the one render/validation walk; `LIMITS`), `components.ts` (built-in tags; their props' TSDoc is the tag reference; `upload`, `md`), `placement.ts` (`composurejs/placement`: which tag may go inside which, and `checkPlacement` over an ESTree program, following function components into relative imports through the caller's `load`; used by the plugin and the lint rule; ADR 0023, 0032. Change a placement rule here and in `jsx/render.ts` together: `test/placement.test.tsx` renders every pair against the table), `transport.ts` (Transport, multipart), `codec.ts` (custom_id fields, escaping, self-describing Captures, Owning Route keys: `id~route:fields`, ADR 0026), `forms.ts` (`form`/`field`: Fields render as Labels; how a Field decodes rides in its input's custom_id after `~`, read by `modalValues`; ADR 0028), `permissions.ts` (`Permission` flags, `c.can`), `handlers.ts` (the handler registry: `__handler` (written by the plugin), `named`, dispatch by Handler Id, modal values by input `name`), `tracker.ts` (Tracker: Background Work for the server Adapters), `log.ts` (Logger, `createLogger` levels/formats, `withFields`: core binds the Interaction's fields to a child, which is `c.log` and the REST clients' logger; ADR 0030), `events.ts` (Webhook Events: decode, EventContext), `sync.ts` (`composurejs/sync`: config from env, targets, plan/normalize, apply, formatPlan; ADR 0016; used by the CLI and the Dev Loop), `rest/` (`client.ts` RestClient/BotClient and op-typed `RequestBody`/`ResponseBody`/`Query`, `endpoints.ts` Tier 1 functions + `ROUTES`, `interaction.ts` Interaction Client, `message.ts` View → body, `schema.d.ts` generated: never edit), `testing/` (TestKey, builders, `answer`, TestPlatform, MockTransport; `answer` uses a fresh MockTransport by default so tests never reach Discord, and `test-bot-token` as the bot token; `res.settle()` runs Background Work and returns the REST requests; `sendEvent` delivers Webhook Events; `recordLogs` records entries).
- `packages/cli/src`: `load.ts` (loads the App via Vite `runnerImport` + the plugin), `cli.ts` (commander program; `main(argv, io)` returns the exit status), `ui.ts` (`Ui`: `@clack/prompts` in a terminal, `recordingUi` in tests), `bin.ts` (the `composure` executable). `test/cli.test.ts` runs it against examples/bot with a MockTransport.
- `packages/create-composurejs/src`: `templates.ts` (`generate(template, name, versions)`: every file of a new bot, one source for cloudflare/node/bun), `create.ts` (commander + clack; `main(argv, env)`), `bin.ts` (bundles the sibling packages' versions at build). `node scripts/check-templates.mjs [template..]` (after `pnpm build`) generates each into `.tmp/templates/`, links the workspace packages, and runs install, typecheck, test, build; CI runs it. Change a template there, never by hand in a generated copy.
- `packages/vite/src/dev.ts`: the Dev Loop (ADR 0031), on only with `composure({ dev })`: `DevOptions` (`application`, `guild`, `tunnel`, `transport`; nothing read from env but `DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY`, `CLOUDFLARE_TUNNEL_TOKEN`, via `env.ts`, which also warns when `.env` sets `DISCORD_TOKEN`), opens the Tunnel, then Repoint; dev Sync to `dev.guild`. Never runs under Vitest without `dev.transport`. `dev-log.ts`: the `[composure]` `TAG` and `DevLog` (`info`/`warn`) every stage logs through. `tunnel.ts`: `Tunnel` (`{ url, address?, close }`), the `dev.tunnel` kinds, `tunnelFor(option)` (default `"quick"`; its `allowedHosts` and `open`, in one place per kind); `quick-tunnel.ts`: ready at cloudflared's registered connection, then an A record from the zone's authoritative nameservers (returned as `address`; nothing resolves the host recursively before). `repoint.ts` (Repoint): checks the token's application is `dev.application` (else logs the URL to set by hand), probes `<url>/interactions` for a 401 (pinned to `address`), PATCHes a field map (429: waits `retry_after`; 400: public-key check, one retry after 65 s). `stage.ts`: per-stage limits (`CONNECT_LIMIT` for every tunnel), `sleep`; a failure is `StageError` (`<stage> failed: ...`). `dev-sync.ts`: `startDevSync` (Definitions via `runnerImport`, debounced, skips unchanged). `cloudflared.ts`: `resolveCloudflared` (`CLOUDFLARED_PATH` → `PATH` → cache → pinned download, SHA-256 from `cloudflared-release.ts`; `node packages/vite/scripts/bump-cloudflared.mjs` bumps it). `test/dev.test.ts` drives a real dev server on a temp project in `test/.tmp/` with a fake Tunnel and a recording transport; `test/repoint.test.ts` covers the long waits.
- `packages/vite/src/named-tunnel.ts`: the Dev Loop's named Cloudflare Tunnel (`dev.tunnel: { name, hostname }`; token from `CLOUDFLARE_TUNNEL_TOKEN`, else): `cloudflared tunnel token`, then `tunnel run` with `TUNNEL_TOKEN`; warns when the tunnel's logged routes miss Vite's port. `test/named-tunnel.test.ts` uses a Node stand-in for cloudflared.
- `packages/vite/src/server.ts` (`@composurejs/vite/server`, ADR 0024): the Default Server (`serve`, `toRequest`/`send`, `onShutdown`, `appOf`), also used by `server()` in `vite dev`; Node APIs only, runs on Node and Bun. `test/server.test.ts` replays core's signed fixtures over it. There are no adapter packages.
- `packages/vite/src/server-plugin.ts`: `server()` (ADR 0025): SSR bundle of the generated `virtual:composure/server` entry around `composure()`'s App module (read through the plugin `api`), or the user's `entry`; serves the App in `vite dev` (`serveInDev`, ADR 0031). Workers builds come from `@cloudflare/vite-plugin`; the plugins never inspect each other beyond that `api`.
- `packages/vite/src/index.ts`: `composure()`: the App module, the Dev Loop, placement warnings (`checkPlacement`; off in core's Vitest config, whose render tests misplace on purpose) and the hoisting transform.
- `packages/eslint-plugin/src/index.ts` (`@composurejs/eslint-plugin`): the `placement` rule over `checkPlacement`, and `configs.recommended`. oxlint loads it as a JS plugin; `test/placement.test.ts` runs both ESLint and the oxlint binary.
- `packages/vite/src/lock.ts`: the Handler Lock (ADR 0029): `composure()` collects each build's shipped handlers and checks `composure.handlers.json` in `buildEnd` (warn and rewrite locally, fail under `CI`); `vite dev` warns per module. The plugin instances that load the App for Sync pass `handlerLock: false`.
- `packages/vite/src/transform.ts`: Inline Handler hoisting (oxc-parser + magic-string, `enforce: "pre"`): every `onClick`/`onSelect`/`onSubmit` function and `named()` call in any module becomes `const __composure_hN = __handler(id, captures, make, where)` after the imports, its site `__composure_hN.bind([..])`. That call is the contract with `handlers.ts`; change both together. Vite is required (ADR 0015): there is no un-compiled API. Vitest configs import the plugin from workspace source, so tests run through it; `test/handlers.test.tsx` imports from `../src/*.ts` by path to get un-compiled code.
- Workspace packages resolve to `src` through the `@composurejs/source` export condition (tsconfig `customConditions`, vitest `ssr.resolve.conditions`). Published consumers get `dist`.
- `bots/composure`: composurejs's own production bot (Workers, deployed by `.github/workflows/bot.yml`), the counterpart of composure-rs's `bots/composure` in the same Discord server; its README's "Next to composure-rs's bot" says what keeps the two apart. Keep its Commands in step with the rs bot's.
- `test/fixtures.tsx`: signed regression fixtures (fixed seed), replayed over `app.fetch` (`test/regression.test.ts`) and over the Default Server (`replayFixtures` in `test/replay.ts`, called from `packages/vite/test/server.test.ts`). Add a case for every new Interaction shape.

## Rules

- Docs: `docs/guide/*.md`, one chapter per topic; code blocks that show API use ```ts twoslash / ```tsx twoslash so a type error fails the docs build (`// ---cut---` hides setup, `// @filename:` splits files). docs pins TypeScript 5.9 because twoslash needs the TypeScript 5 compiler API. Update the chapter when an API changes.

- Core (all of `packages/composurejs/src`) must not use Node APIs or types. `tsconfig.core.json` enforces it.
- Zero runtime dependencies. `discord-api-types` is imported with `import type` only, so its enums are restated in `src/discord.ts`.
- Logs are structured objects. Never log the interaction token, a URL containing it, or Custom ID State.
- Unknown Discord data (interaction types, component types, events) is answered or passed through. It must never throw.
- Use the words in `CONTEXT.md`. Record decisions as `docs/adr/NNNN-*.md`: one dense paragraph or a few, saying what was decided and why, plus the alternatives that were rejected.

## Agent skills

### Issue tracker

GitHub Issues on BlueFrog130/composure-js, via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` is the glossary, ADRs in `docs/adr/`. See `docs/agents/domain.md`.
