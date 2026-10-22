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

Use pnpm only. pnpm 12 blocks dependency build scripts unless they're listed in `allowBuilds` in `pnpm-workspace.yaml`.

## Layout

- `packages/composurejs/src`: `app.ts` (App builder, tree build/checks, Credentials/Bot Data loaders cached per isolate), `pipeline.ts` (verify → parse → Ping → dispatch → render/Error Renderer; `handleInteraction`), `context.ts` (`c`), `command.ts` (command/group/userCommand/messageCommand + definitions), `options.ts` (Option builders, value inference, resolution, rule checks), `middleware.ts` (`runChain`), `factory.ts` (`createFactory<Env>()`), `response.ts` (Output → InteractionResponse), `verify.ts` (WebCrypto Ed25519, key cached per isolate), `jsx/` (node tree + the one render/validation walk), `components.ts` (built-in tags), `adapters/` (cloudflare, node, bun; `tracker.ts` Background Work), `testing/` (TestKey, builders, `answer`, TestPlatform).
- Workspace packages resolve to `src` through the `@composurejs/source` export condition (tsconfig `customConditions`, vitest `ssr.resolve.conditions`). Published consumers get `dist`.
- `test/fixtures.tsx`: signed regression fixtures (fixed seed), replayed against every Adapter in `test/regression.test.ts`. Add a case for every new Interaction shape.

## Rules

- Core (everything except `adapters/node.ts`, `adapters/bun.ts`, `adapters/shutdown.ts`) must not use Node APIs or types. `tsconfig.core.json` enforces it.
- Zero runtime dependencies. `discord-api-types` is imported with `import type` only, so its enums are restated in `src/discord.ts`.
- Logs are structured objects. Never log the interaction token, a URL containing it, or Custom ID State.
- Unknown Discord data (interaction types, component types, events) is answered or passed through. It must never throw.
- Use the words in `CONTEXT.md`. Record decisions as `docs/adr/NNNN-*.md`: one dense paragraph or a few, saying what was decided and why, plus the alternatives that were rejected.
