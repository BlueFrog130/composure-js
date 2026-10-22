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
import { Button, Row } from "composurejs"
declare function refresh(): Promise<number>
// ---cut---
export const Refresh = () => (
  <Row>
    <Button onClick={(c) => c.deferUpdate(async () => <Row><Button customId="done">{`Refreshed: ${await refresh()}`}</Button></Row>)}>Refresh</Button>
  </Row>
)
```

## When the work fails

A failure is logged, and the [Error Renderer](./responses#errors) produces what the user sees:

- After `c.defer`, that output replaces the loading message.
- After `c.deferUpdate`, it is sent as an ephemeral follow-up, so the component's message keeps its state.

Background Work can reach Discord before the deferred reply is registered. The final edit retries briefly when Discord answers 404.
