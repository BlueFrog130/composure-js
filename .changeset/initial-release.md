---
"composurejs": minor
"@composurejs/vite": minor
"@composurejs/cli": minor
"@composurejs/eslint-plugin": minor
"create-composurejs": minor
---

First release: Discord bots over HTTP Interactions on Cloudflare Workers, Node and Bun. Commands
typed from their definitions, JSX messages checked against Discord's limits, Inline Handlers
compiled by `@composurejs/vite`, deferred responses, a spec-checked REST client, Webhook Events,
`composure sync`, the `vite dev` Dev Loop, placement checks at build time and in the editor
(`@composurejs/eslint-plugin`, for ESLint and oxlint), and `pnpm create composurejs`. Workers
serves `export default app`; for Node and Bun, `server()` builds the App into a Default Server
(`@composurejs/vite/server`), or your own `entry`.
