# Structured logging: bound fields, levels, formats, `c.log`

The counterpart of composure-rs's [ADR 0010](https://github.com/BlueFrog130/composure-rs/blob/main/docs/adr/0010-tracing.md), in TypeScript and without dependencies. `Logger` stays one object per call (`{ msg, ...fields }`) with `debug`/`info`/`warn`/`error`, plus an optional `child(fields)`. That shape is what pino's loggers already are, so pino can be passed as it is. While answering an Interaction, core binds a child with what rs's `interaction` span carries: `interactionId`, `interactionType`, `command`, or for clicks and modal submits `handler` (the `custom_id` prefix, never Custom ID State), plus `guildId` and `userId`. Webhook Events bind `event`. That child is the logger of the Interaction's REST clients and Background Work, and handlers receive it as `c.log`. Without it, call sites had to repeat `interactionId` by hand, REST and rate-limit entries could not be tied to an Interaction, and handlers fell back to `console.log`. A logger without `child` is wrapped by `withFields`, which merges the fields into each entry. The built-in `createLogger({ level, format, fields })` replaces `consoleLogger`. It defaults to `info` (rs's default too), because `consoleLogger` wrote every REST response at debug, and on Workers each line is a billed Workers Logs event. It serializes `Error` fields with their `cause` chain and never throws. It writes one of three formats:

- `object`: the default on Workers (detected by `navigator.userAgent`), indexed by Workers Logs.
- `pretty`: the default elsewhere, a readable line plus stacks, since `vite dev` on Node is where people read logs.
- `json`: one line with `time` and `level`, opt-in for log pipelines on Node and Bun.

`new App({ logger })` takes a Logger or these options. `composurejs/testing` adds `recordLogs()`, so tests no longer each define a recording logger.

Rejected alternatives:

- Depending on pino or another logging library: core has zero runtime dependencies, and pino uses Node APIs.
- A span or AsyncLocalStorage-based context: it isn't on every fetch runtime, and an explicit child passed down costs nothing.
- `json` as the default off Workers: it's unreadable while developing.
- Reading `NODE_ENV` to choose a format: core does not touch Node globals.
