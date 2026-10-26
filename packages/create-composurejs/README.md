# <img src="https://raw.githubusercontent.com/BlueFrog130/composure-js/main/assets/logo.svg" width="32" height="32" alt="" align="top"> create-composurejs

[![npm](https://img.shields.io/npm/v/create-composurejs?color=5865f2)](https://www.npmjs.com/package/create-composurejs)
[![Guide](https://img.shields.io/badge/docs-guide-5865f2)](https://bluefrog130.github.io/composure-js/)
[![License](https://img.shields.io/npm/l/create-composurejs?color=blue)](https://github.com/BlueFrog130/composure-js/blob/main/LICENSE)

Creates a [composurejs](https://www.npmjs.com/package/composurejs) Discord bot.

```sh
pnpm create composurejs my-bot
```

Pick a runtime (Cloudflare Workers, Node or Bun) and, optionally, your dev application and test server ids. You get a working bot with `/ping`, `/greet` and a `/counter` with buttons, its tests, and the dev loop wired up:

```sh
cd my-bot
cp .env.example .env.local   # DISCORD_PUBLIC_KEY and DISCORD_TOKEN of your dev application
pnpm dev                     # tunnel, endpoint and Commands set up for you
```

| Option | |
|---|---|
| `-t, --template <name>` | `cloudflare`, `node` or `bun` |
| `--application <id>` | Your dev application's id |
| `--guild <id>` | Your test server's id |
| `--no-install` | Skip installing dependencies |
| `-y, --yes` | Use the defaults for anything not given |

Guide: [Getting started](https://bluefrog130.github.io/composure-js/guide/getting-started)
