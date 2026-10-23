---
"create-composurejs": minor
---

Asks for the Dev Application and dev guild ids (or `--application`/`--guild`) and writes them into `vite.config.ts` as `composure({ dev: { application, guild } })`, or `dev: {}` when skipped. Secrets go in `.env.local` (Dev Application) and `.env.production.local` (production, read by `pnpm start` and `pnpm sync`); `.dev.vars` and the `COMPOSURE_DEV_*` variables are gone.
