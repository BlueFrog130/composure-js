# Handlers and Views

A View is a function from props to markup. A click is answered by a function written on the button itself:

```tsx twoslash
import { Button, command, Container, Row, Text } from "composurejs"
// ---cut---
const STEPS = [1, 5]

export const Counter = ({ count, owner }: { count: number; owner: string }) => (
  <Container>
    <Text>## Count: {count}</Text>
    <Row>
      {STEPS.map((step) => (
        <Button onClick={(c) => (c.user.id === owner ? <Counter count={count + step} owner={owner} /> : c.ephemeral("Not yours"))}>
          +{step}
        </Button>
      ))}
    </Row>
  </Container>
)

export const counter = command({ name: "counter", description: "A counter", handler: (c) => <Counter count={0} owner={c.user.id} /> })
```

Markup a handler returns **updates the clicked message**. `c.reply(..)` and `c.ephemeral(..)` answer with a new message instead. There's nothing to register.

## How it works

Discord keeps no state between clicks. Each click is a new HTTP request, possibly handled by a different isolate, possibly after a deploy. The only thing that comes back is the button's `custom_id`, at most 100 characters.

`@composurejs/vite` therefore compiles every `onClick`, `onSelect` and `onSubmit` written as a function:

1. It hoists the function to module scope under a stable **handler id**.
2. It finds what the function reads from the functions around it. Here that's `owner`, `count` and the loop's `step`. A command handler's `c` counts too.
3. It writes those values into the `custom_id`, compactly. The counter's ids are `_Kq3vX9a:i2ckt9ru6z01:n0:n5`: an id, then the owner (a snowflake in base 36), the count and the step.

On a click, the id finds the handler, the values are decoded, and the handler runs with them. **Vite is required**: without the plugin, an `onClick` that is still a function fails at render, saying so.

## What a handler may read

- **Strings, numbers, booleans** (and `null` / `undefined`) from props, locals and loop variables. Read the part you need: `item.id`, not `item`. Capturing an object or a function fails at render, saying what to capture instead.
- **Anything at module scope**: imports, constants, other components. A component a handler renders must be defined at module scope; one defined inside a function is a compile error.
- **Not too much.** Everything captured must fit in 100 characters. Carry an id and load the rest instead; an async component makes that natural:

```tsx twoslash
import { Button, Row } from "composurejs"
declare const db: { get(id: string): Promise<{ name: string; score: number }>; bump(id: string): Promise<void> }
// ---cut---
export const Profile = async ({ id }: { id: string }) => {
  const row = await db.get(id)
  return (
    <Row>
      <Button onClick={async () => (await db.bump(id), <Profile id={id} />)}>{`${row.name}: ${row.score}`}</Button>
    </Row>
  )
}
```

## Ids, deploys, and `named()`

Messages stay in channels for months, so their buttons must keep working across deploys. A generated id is a hash of the file, the declaration around the handler (`Counter`), its position there, and what it captures. Editing the handler's body, or anything else in the file, keeps the id. Moving or renaming it, reordering handlers within one component, or capturing something new changes it. Old buttons then answer "This message is outdated.", never with the wrong handler.

For messages meant to last, such as role menus or polls, give the handler a fixed id:

```tsx twoslash
import { Button, named, Row } from "composurejs"
// ---cut---
export const RoleMenu = ({ role }: { role: string }) => (
  <Row>
    <Button onClick={named("toggle-role", (c) => c.ephemeral(`Toggled ${role}`))}>Toggle</Button>
  </Row>
)
```

## Selects and modals

Annotate a select's values to type them:

```tsx twoslash
import { defineChoices, Row, StringSelect } from "composurejs"
// ---cut---
const Toppings = defineChoices({ nuts: "Nuts", salt: "Sea salt" })

export const Picker = () => (
  <Row>
    <StringSelect maxValues={2} options={Toppings} onSelect={(c, values: ("nuts" | "salt")[]) => c.reply(`Picked ${values.join(" and ")}`)} />
  </Row>
)
```

A button can open a modal by returning it. Markup the modal's `onSubmit` returns updates the message the button was on:

```tsx twoslash
import { Button, Label, Modal, Row, Text, TextInput } from "composurejs"
// ---cut---
const Thanks = ({ why }: { why: string }) => <Text>Reported: {why}</Text>

export const Report = ({ post }: { post: string }) => (
  <Row>
    <Button
      onClick={() => (
        <Modal title={`Report ${post}`} onSubmit={(c, v: { why: string }) => <Thanks why={v.why} />}>
          <Label text="Why?">
            <TextInput name="why" />
          </Label>
        </Modal>
      )}
    >
      Report
    </Button>
  </Row>
)
```

Submitted values are keyed by input `name`:

- a string for text inputs and radio groups (`undefined` when left empty)
- a boolean for checkboxes
- a list for selects and checkbox groups
- resolved attachments for file uploads
