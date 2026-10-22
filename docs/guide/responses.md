# Responses

A handler answers by returning a value:

| Return | Discord shows |
|---|---|
| a string | a message with that text |
| JSX (`<Container>..</Container>`) | a Components V2 message, checked against [Discord's limits](./components#limits) |
| `c.ephemeral(x)` / `Ephemeral(x)` | `x`, visible only to the user who invoked it |
| a `<Modal>` | the modal, opened |
| `c.defer(..)` | a loading state, then the result ([Deferring](./deferring)) |
| from a click: markup | the clicked message, updated ([Handlers](./views)) |
| from a click: `c.reply(x)` | a new message instead |
| a raw `InteractionResponse` | exactly that, as an escape hatch |

```tsx twoslash
import { command, Container, Text } from "composurejs"
// ---cut---
export const secret = command({
  name: "secret",
  description: "Only you can see this",
  handler: (c) =>
    c.ephemeral(
      <Container accentColor={0x5865f2}>
        <Text>## The answer is {6 * 7}</Text>
      </Container>,
    ),
})
```

## Message settings

A View is the whole message. Wrap it in `<Message>` for message-level settings:

```tsx twoslash
import { command, Message, Text } from "composurejs"
// ---cut---
export const announce = command({
  name: "announce",
  description: "Announce quietly",
  handler: (c) => (
    <Message suppressNotifications allowedMentions={{ parse: [] }}>
      <Text>Release notes are out, {`<@${c.user.id}>`}</Text>
    </Message>
  ),
})
```

## Files

`upload(name, data)` attaches a file. Pass it as the `src` of `<File>`, `<Thumbnail>` or `<Item>`, and it is sent with the message and referenced as `attachment://<name>`:

```tsx twoslash
import { command, File, Text, upload } from "composurejs"
// ---cut---
export const report = command({
  name: "export",
  description: "Export as CSV",
  handler: () => (
    <>
      <Text>Your export</Text>
      <File src={upload("export.csv", "name,score\nAda,7", { contentType: "text/csv" })} />
    </>
  ),
})
```

Answers with files go through Discord's callback endpoint and the HTTP request is answered with 202; composurejs does this for you.

## Errors

`throw new UserError("..")` shows that message to the user, ephemeral. Any other error is logged, with its `cause` chain, and the user sees "Something went wrong.". To customize what users see, set an Error Renderer. It also handles failures in [deferred work](./deferring):

```tsx twoslash
import { App, Text, UserError } from "composurejs"
// ---cut---
export const app = new App().onError((error, c) =>
  error instanceof UserError ? <Text>⚠️ {error.message}</Text> : <Text>Something broke. We've been told.</Text>,
)
```

Its output is always ephemeral. At most one App in a tree may set `onError`.
