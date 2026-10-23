---
"@composurejs/cli": minor
---

`composure sync` reads the same env files as Vite for `--mode` (default `production`): the Dev Application's secrets in `.env.local` (`--mode development`) and production's in `.env.production.local`, which wins over `.env.local` in production mode. The process environment wins over both. In production mode it warns when `DISCORD_TOKEN` still comes from `.env.local` (set in neither the environment nor `.env.production.local`). `composure sync --help` describes them.
