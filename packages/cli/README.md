# <img src="https://raw.githubusercontent.com/BlueFrog130/composure-js/main/assets/logo.svg" width="32" height="32" alt="" align="top"> @composurejs/cli

[![npm](https://img.shields.io/npm/v/@composurejs/cli?color=5865f2)](https://www.npmjs.com/package/@composurejs/cli)
[![Guide](https://img.shields.io/badge/docs-guide-5865f2)](https://bluefrog130.github.io/composure-js/)
[![License](https://img.shields.io/npm/l/@composurejs/cli?color=blue)](https://github.com/BlueFrog130/composure-js/blob/main/LICENSE)
[![Discord](https://img.shields.io/badge/chat-discord-5865f2?logo=discord&logoColor=white)](https://discord.com/invite/8rWjWtp3pG)

`composure sync` makes Discord's Commands match your [composurejs](https://www.npmjs.com/package/composurejs) App. It shows what will change, asks, then applies it. Commands on Discord that the App no longer has are deleted.

```sh
pnpm add -D @composurejs/cli
```

```sh
pnpm exec composure sync                   # show the plan, ask, apply
pnpm exec composure sync --check           # CI: exit 2 when Discord is out of date
pnpm exec composure sync --guild <id>      # everything to one server, to try it out
pnpm exec composure sync --mode development  # read the dev application's .env files
```

It reads `DISCORD_TOKEN` from the environment or the same `.env` files Vite would for `--mode` (`production` by default, so `.env.production.local`). The App is loaded through Vite with `@composurejs/vite`, so it sees the same code your build does.

| Option | |
|---|---|
| `--app <file>` | Module exporting the App (default `src/app.tsx`) |
| `--root <dir>` | Project root |
| `--mode <mode>` | Which `.env` files to load |
| `--guild <id>` | Send every Command to this server |
| `--dry-run` | Only show the plan |
| `--check` | Only show the plan; exit 2 when out of date |
| `-y, --yes` | Apply without asking |

Guide: [Deploying](https://bluefrog130.github.io/composure-js/guide/deploying#sync)
