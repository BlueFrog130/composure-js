# Contributing

```sh
pnpm install
pnpm test        # builds the packages, then every test (incl. building and running the example per target)
pnpm typecheck
node scripts/check-templates.mjs   # create-composurejs templates: install, typecheck, test, build
pnpm size        # bundle budgets
pnpm -C docs build                 # the guide; type-checks every twoslash snippet
```

Read `CONTEXT.md` (the words) and the ADRs in `docs/adr/` (the decisions) before changing behavior;
record a new decision as the next ADR.

## Releasing

Packages are versioned independently with [Changesets](https://github.com/changesets/changesets).
A change to a published package (`composurejs`, `@composurejs/vite`, `@composurejs/cli`,
`@composurejs/eslint-plugin`, `create-composurejs`) needs a changeset: `pnpm changeset`. On `main`,
the release workflow opens a "Version Packages" PR that applies them (versions and changelogs);
merging it publishes to npm through trusted publishing, with provenance. Never bump versions by
hand.
