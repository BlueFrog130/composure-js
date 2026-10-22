# Logging

composurejs logs structured entries: one object per line, with a `msg` and fields. Everything logged while answering an Interaction carries its fields, whether core logged it, your handler did, or a REST call or Background Work did:

| Field | |
| --- | --- |
| `interactionId`, `interactionType` | Which Interaction. |
| `command` | The Command's name, for Commands and autocomplete. |
| `handler` | The handler's id, for clicks and modal submits (never the values it carries). |
| `guildId`, `userId` | Where and who. |
| `event` | The type, for [Webhook Events](./events). |

## In handlers

`c.log` is the logger with those fields bound. Middleware, handlers and Event Handlers all have it:

```tsx twoslash
import { command } from "composurejs"
// ---cut---
export const grant = command({
  name: "grant",
  description: "Grant the role",
  handler: (c) => {
    c.log.info({ msg: "Role granted", roleId: "123" })
    return "Done."
  },
})
```

Pass errors as fields. They are written with their `cause` chain, and a `DiscordApiError` keeps its `status`, `code` and per-field `errors`. Never log the Interaction token or a URL that contains it.

## Levels and formats

The default is `info` and above. `debug` adds REST responses, retries, Auto Defers, Fallbacks and User Errors. The App takes options for the built-in logger:

```ts twoslash
import { App } from "composurejs"
// ---cut---
const app = new App({ logger: { level: "debug", format: "json" } })
```

- `object` (the default on Workers) makes one console call with an object, which Workers Logs indexes by field.
- `pretty` (the default elsewhere) writes `LEVEL msg key=value`, then error stacks. It's made for reading in a terminal.
- `json` writes one JSON line with `time` and `level`, for log pipelines on Node and Bun.

`createLogger(options)` builds the same logger for use outside the App. `fields` adds fields to every entry, for example `{ service: "bot" }`.

## Your own logger

Pass any object with `debug`, `info`, `warn` and `error`. Each method receives one entry object. pino's loggers work as they are, and their `child` is used to bind fields:

```ts twoslash
// @noErrors
import pino from "pino"
import { App } from "composurejs"
// ---cut---
const app = new App({ logger: pino() })
```

A logger without `child` is wrapped, and the bound fields are merged into each entry.

## In tests

`recordLogs()` keeps every entry with its level and bound fields:

```ts twoslash
import { App, command } from "composurejs"
const ping = command({ name: "ping", description: "Pong", handler: () => "pong" })
// ---cut---
import { expect, test } from "vitest"
import { answer, chatInput, recordLogs } from "composurejs/testing"

test("pinging logs nothing above info", async () => {
  const logs = recordLogs()
  await answer(new App({ logger: logs.logger }).command(ping), chatInput("ping"))
  expect(logs.entries.filter((e) => e.level === "warn" || e.level === "error")).toEqual([])
})
```
