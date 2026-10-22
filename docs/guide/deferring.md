# Deferring

Discord waits 3 seconds for an answer. For anything slower, `c.defer` answers right away with a loading state, then edits the message with the result:

```tsx twoslash
import { command, Text } from "composurejs"
declare function buildReport(user: string): Promise<string>
// ---cut---
export const report = command({
  name: "report",
  description: "A slow report",
  handler: (c) =>
    c.defer(async () => {
      const text = await buildReport(c.user.id)
      return <Text>{text}</Text>
    }),
})
```

The work runs as **Background Work** after the answer is sent:

- **Workers:** through `ctx.waitUntil`, which allows about 30 seconds after the response. Longer jobs belong in a Queue or Workflow.
- **Node and Bun:** on tracked promises, awaited on shutdown for up to 30 seconds.

## Ephemeral

Discord decides whether a deferred reply is ephemeral when you defer, so you choose then too:

```tsx twoslash
import { command } from "composurejs"
// ---cut---
export const quiet = command({
  name: "quiet",
  description: "A private, slow answer",
  handler: (c) => c.defer(async () => "Only you see this", { ephemeral: true }),
})
```

Returning `c.ephemeral(..)` from work deferred publicly is an error.

## Updating a component's message

From a click, `c.deferUpdate` acknowledges without changing anything, then edits the clicked message with the result:

```tsx twoslash
import { Button, Row, Text } from "composurejs"
declare function refresh(): Promise<number>
// ---cut---
export const Refresh = () => (
  <Row>
    <Button onClick={(c) => c.deferUpdate(async () => <Text>Refreshed: {await refresh()}</Text>)}>Refresh</Button>
  </Row>
)
```

## When the work fails

A failure is logged, and the [Error Renderer](./responses#errors) produces what the user sees:

- After `c.defer`, that output replaces the loading message.
- After `c.deferUpdate`, it is sent as an ephemeral follow-up, so the component's message keeps its state.

Background Work can reach Discord before the deferred reply is registered. The final edit retries briefly when Discord answers 404.

## Auto Defer

You don't have to predict which handlers are slow. If one hasn't answered 2 seconds after the request arrived, composurejs defers for it: a Command gets the loading state, a click or a modal submit from a message is acknowledged without changing anything. When the handler returns, its answer is edited in, as if it had called `c.defer` itself:

```tsx twoslash
import { command, Text } from "composurejs"
declare function search(query: string): Promise<string>
// ---cut---
export const lookup = command({
  name: "lookup",
  description: "Usually fast, sometimes not",
  handler: async () => <Text>{await search("cookies")}</Text>, // deferred only when it is slow
})
```

- Discord fixes whether the loading state is ephemeral, so an Auto Defer is public. If the answer then turns out ephemeral, the public loading message is deleted and the answer is sent privately, and a warning suggests `autoDefer: "ephemeral"` on that Command, which makes the loading state private instead.
- A click that answers with `c.reply(..)` gets its new message as a follow-up; the clicked message stays as it was.
- A `<Modal>` cannot open after deferring. Open it first, before any slow work, or set `autoDefer: false` on the Command.
- Change the threshold with `new App({ autoDefer: { after: 2500 } })`, turn it off with `new App({ autoDefer: false })`, or per Command with `autoDefer: false`. A Group's setting covers its subcommands unless they set their own.
- Autocomplete is never deferred: Discord doesn't allow it.

`c.defer` remains the clearer choice for work you know is slow: it answers at once and states the ephemerality.
