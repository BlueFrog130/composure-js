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

## Where a handler can come from

- **Written inline**, as above. Each branch of `?:`, `&&`, `||` and `??` counts: `onClick={mine ? (c) => .. : (c) => ..}` hoists both.
- **A local function**, declared with `const` or `function` in the component (or command handler) and named by the prop. It captures what it reads around it, like an inline handler, and is read when the message renders. It stays an ordinary function you can call:

```tsx twoslash
import { Button, type ComponentContext, Row } from "composurejs"
// ---cut---
export const Counter = ({ count, owner }: { count: number; owner: string }) => {
  const add = (c: ComponentContext) => (c.user.id === owner ? <Counter count={count + 1} owner={owner} /> : c.ephemeral("Not yours"))
  return (
    <Row>
      <Button onClick={add}>+1</Button>
      <Button onClick={reset}>Reset</Button>
    </Row>
  )
  function reset() {
    return <Counter count={0} owner={owner} />
  }
}
```

- **A function at module scope or an import**: `onClick={refresh}`. It captures nothing, so it reads only `c` and what is at module scope.
- **A handler prop passed on** by a wrapper component, unchanged:

```tsx twoslash
import { Button, type ClickHandler, Row } from "composurejs"
// ---cut---
const Primary = ({ label, onClick }: { label: string; onClick: ClickHandler }) => (
  <Button style="primary" onClick={onClick}>
    {label}
  </Button>
)

export const Menu = ({ page }: { page: number }) => (
  <Row>
    <Primary label="Next" onClick={() => <Menu page={page + 1} />} />
  </Row>
)
```

The handler is compiled where it is written (`<Primary onClick={..}>`), and `Primary` receives its reference. A handler made by a call (`onClick={make(x)}`), a local that does not hold a function written there (`const go = make(x)`), and one declared with `let` cannot be hoisted and are compile errors. So is a hoisted handler that reads a function declared inside a function, including a local handler naming itself: declare that function inside the handler, or at module scope. One message cannot place the same handler with the same captures twice, since each `custom_id` must be unique.

## What a handler may read

- **Strings, numbers, booleans** (and `null` / `undefined`) from props, locals and loop variables. Read the part you need: `item.id`, not `item`. Capturing an object or a function fails at render, saying what to capture instead (reading a function declared inside a function fails at compile time).
- **Anything at module scope**: imports, constants, other components. A component a handler renders must be defined at module scope; one defined inside a function is a compile error.
- **Not too much.** Everything captured must fit in 100 characters. Carry an id and load the rest instead, for example in an async component:

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

The [Handler Lock](./deploying#the-handler-lock) catches such changes before they ship. For messages meant to last, such as role menus or polls, give the handler a fixed id:

```tsx twoslash
import { Button, named, Row } from "composurejs"
// ---cut---
export const RoleMenu = ({ role }: { role: string }) => (
  <Row>
    <Button onClick={named("toggle-role", (c) => c.ephemeral(`Toggled ${role}`))}>Toggle</Button>
  </Row>
)
```

### Code splitting

A handler is registered when its module loads, so every module with handlers must be in the bundle when the first click arrives. A handler in a module loaded with `import()` is unknown until something loads it, and clicks before that answer "This message is outdated.". Import modules with handlers statically; on Workers and in the Default Server everything is one bundle anyway.

## Selects and modals

A select's values are typed from its `options`:

```tsx twoslash
import { defineChoices, Row, StringSelect } from "composurejs"
// ---cut---
const Toppings = defineChoices({ nuts: "Nuts", salt: "Sea salt" })

export const Picker = () => (
  <Row>
    <StringSelect maxValues={2} options={Toppings} onSelect={(c, values) => c.reply(`Picked ${values.join(" and ")}`)} />
  </Row>
)
```

With `<Option>` children instead, annotate them: `(c, values: Topping[]) => ..`.

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

Those values are typed by annotation, which TypeScript does not check against the inputs.

## Forms

A Form defines a modal's inputs once: the modal renders from it, and `onSubmit`'s values are typed and parsed from it.

```tsx twoslash
import { command, defineChoices, field, form, Modal, Text } from "composurejs"
// ---cut---
const Mood = defineChoices({ great: "Great", fine: "Fine", meh: "Meh" })

const feedback = form({
  mood: field.radio(Mood, { label: "How is it going?" }),
  stars: field.integer({ label: "Stars", min: 1, max: 5 }),
  notes: field.text({ label: "Anything to add?", paragraph: true }).optional(),
})

export const review = command({
  name: "review",
  description: "Leave a review",
  handler: () => (
    <Modal title="Review" form={feedback} values={{ stars: 5 }} onSubmit={(c, v) => c.ephemeral(`${v.mood}, ${v.stars}★`)}>
      <Text>Thanks for taking a minute.</Text>
    </Modal>
  ),
})
```

- Each Field renders as a `<Label>` with its input, after any `<Text>` children; a `<Label>` of your own next to `form` is an error. A modal holds 5 in all.
- `values` prefills Fields. Every Field is required unless `.optional()`, which makes its value `undefined` when left empty (an empty list for Fields that take several).
- `field.integer` and `field.number` parse the text and check `min` / `max`. Bad input answers the user with what is wrong (`"Stars" must be at most 5.`) without calling `onSubmit`.
- `field.user`, `role`, `mentionable` and `channel` give the resolved users, roles and channels; `field.files` gives attachments.

| Field | Value |
|---|---|
| `field.text({ paragraph, minLength, maxLength, placeholder })` | `string` |
| `field.integer({ min, max })`, `field.number({ min, max })` | `number` |
| `field.radio(choices)` | one choice's value |
| `field.select(choices, { min, max })`, `field.checkboxes(choices, { min, max })` | a list of values |
| `field.checkbox()` | `boolean` |
| `field.user()`, `field.role()`, `field.mentionable()`, `field.channel({ types })` | a list of resolved entities |
| `field.files({ types })` | a list of attachments |
