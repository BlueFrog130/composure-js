---
"@composurejs/cli": minor
---

`composure sync` no longer reads `.dev.vars`. Secrets live in `.env.local` (the Dev Application's; `--mode development`) and `.env.production.local` (production's, read in production mode only, the default, where it wins over `.env.local`). `composure sync --help` describes both.
