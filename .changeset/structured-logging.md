---
"composurejs": minor
---

Structured logging: everything logged while answering an Interaction (REST calls and Background
Work included) carries `interactionId`, `interactionType`, `command` or `handler`, `guildId` and
`userId`; handlers log through `c.log`. `createLogger({ level, format, fields })` replaces
`consoleLogger`: `info` by default, `object` format on Workers, `pretty` elsewhere, `json` for log
pipelines. `new App({ logger })` takes a Logger (pino's fits) or those options.
`recordLogs()` in `composurejs/testing`.
