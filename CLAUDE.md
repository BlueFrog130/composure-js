# CLAUDE.md

composurejs: TypeScript framework for HTTP-interaction-only Discord bots on any fetch runtime. Port of the ideas of composure-rs (github.com/BlueFrog130/composure-rs); when unsure of behavior, check what it does and its ADR.

## Commands

```sh
pnpm install
pnpm test                      # vitest projects: packages/*, examples/*
pnpm vitest run -t "signed fixtures"   # one test by name
pnpm typecheck                 # per package; composurejs also runs tsconfig.core.json (no Node types)
pnpm build                     # tsdown; examples/bot's wrangler needs dist
pnpm --filter @composurejs/example-bot check:worker   # wrangler dry-run bundle size
```

REST: `spec/openapi.json` is Discord's spec at the commit in `spec/PINNED`; `node packages/composurejs/scripts/update-spec.mjs [sha]` refreshes it and regenerates `src/rest/schema.d.ts` (via TypeScript 5.9 in `pnpm dlx`; openapi-typescript cannot run on TypeScript 7). A new Endpoint goes in `ROUTES` with the spec's exact path and operationId; `PRINT_UNIMPLEMENTED=1 pnpm vitest run rest-spec` lists the rest.

Use pnpm only. pnpm 12 blocks dependency build scripts unless they're listed in `allowBuilds` in `pnpm-workspace.yaml`.

## Layout

- `packages/composurejs/src`: `app.ts` (App builder, tree build/checks, Credentials/Bot Data loaders cached per isolate), `pipeline.ts` (verify → parse → Ping → dispatch → render/Error Renderer; `handleInteraction`), `context.ts` (`c`), `command.ts` (command/group/userCommand/messageCommand + definitions), `options.ts` (Option builders, value inference, resolution, rule checks), `middleware.ts` (`runChain`), `factory.ts` (`createFactory<Env>()`), `response.ts` (Output → InteractionResponse), `verify.ts` (WebCrypto Ed25519, key cached per isolate), `jsx/` (node tree + the one render/validation walk; `LIMITS`), `components.ts` (built-in tags; their props' TSDoc is the tag reference; `upload`, `md`), `transport.ts` (Transport, multipart), `codec.ts` (`p.*`, custom_id fields and escaping), `fields.ts` (`f.*`, `field=` refs, parsing submits), `handlers.ts` (`component()`, `modal()`, `view()`, the `on.$`/`handlers` contract with the plugin, dispatch by prefix), `adapters/` (cloudflare, node, bun; `tracker.ts` Background Work), `events.ts` (Webhook Events: decode, EventContext), `rest/` (`client.ts` RestClient/BotClient and op-typed `RequestBody`/`ResponseBody`/`Query`, `endpoints.ts` Tier 1 functions + `ROUTES`, `interaction.ts` Interaction Client, `message.ts` View → body, `schema.d.ts` generated: never edit), `testing/` (TestKey, builders, `answer`, TestPlatform, MockTransport; `answer` uses a fresh MockTransport by default so tests never reach Discord, and `test-bot-token` as the bot token; `res.settle()` runs Background Work and returns the REST requests; `sendEvent` delivers Webhook Events).
- `packages/vite/src/transform.ts`: Inline Handler hoisting (oxc-parser + magic-string, `enforce: "pre"`). Its output shape must match `HoistedHandler` and `on.$` in `handlers.ts`; change both together. Vitest configs import the plugin from workspace source, so tests run through it; `test/views.test.tsx` imports `view` from `../src/handlers.ts` by path to get an un-hoisted View.
- Workspace packages resolve to `src` through the `@composurejs/source` export condition (tsconfig `customConditions`, vitest `ssr.resolve.conditions`). Published consumers get `dist`.
- `test/fixtures.tsx`: signed regression fixtures (fixed seed), replayed against every Adapter in `test/regression.test.ts`. Add a case for every new Interaction shape.

## Rules

- Core (everything except `adapters/node.ts`, `adapters/bun.ts`, `adapters/shutdown.ts`) must not use Node APIs or types. `tsconfig.core.json` enforces it.
- Zero runtime dependencies. `discord-api-types` is imported with `import type` only, so its enums are restated in `src/discord.ts`.
- Logs are structured objects. Never log the interaction token, a URL containing it, or Custom ID State.
- Unknown Discord data (interaction types, component types, events) is answered or passed through. It must never throw.
- Use the words in `CONTEXT.md`. Record decisions as `docs/adr/NNNN-*.md`: one dense paragraph or a few, saying what was decided and why, plus the alternatives that were rejected.
