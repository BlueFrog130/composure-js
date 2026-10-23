---
"@composurejs/cli": minor
---

`composure sync` reads the same env files as Vite for `--mode` (default `production`): the Dev Application's secrets in `.env.local` (`--mode development`) and production's in `.env.production.local`, which wins over `.env.local` in production mode. The process environment wins over both. `composure sync --help` describes them.
