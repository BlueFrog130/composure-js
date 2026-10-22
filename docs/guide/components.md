# Components

Messages are JSX built from Discord's Components V2. The tags are exported functions, so your editor completes them and shows each prop's documentation on hover. There's no React: the JSX becomes Discord's component JSON directly.

```json
// tsconfig.json
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "composurejs" } }
```

## Layout

```tsx twoslash
import { Button, Container, Section, Separator, Text, Thumbnail } from "composurejs"
// ---cut---
export const Card = ({ title, avatar }: { title: string; avatar: string }) => (
  <Container accentColor={0x57f287}>
    <Section accessory={<Thumbnail src={avatar} description="Avatar" />}>
      <Text>## {title}</Text>
      <Text>-# updated just now</Text>
    </Section>
    <Separator spacing="large" />
    <Section accessory={<Button url="https://discord.com">Open</Button>}>More on the web</Section>
  </Container>
)
```

| Tag | Holds |
|---|---|
| `<Container>` | anything a message holds except another `<Container>`; `accentColor`, `spoiler` |
| `<Section>` | 1-3 blocks of text, plus an `accessory`: a `<Button>` or `<Thumbnail>` |
| `<Text>` | one block of markdown |
| `<Separator>` | space, with or without a line (`divider`, `spacing`) |
| `<Row>` | up to 5 `<Button>`s, or one select |
| `<Gallery>` | 1-10 `<Item>`s (images, videos) |
| `<File>` | an attached file |

## Text and the newline trap

JSX drops line breaks and indentation, but Discord markdown is line-based (`## heading`, `- list`, `-# small`). So:

```tsx twoslash
import { md, Text } from "composurejs"
const items = ["one", "two"]
// ---cut---
export const Notes = () => (
  <>
    <Text>## One block per Text</Text>
    <Text>
      first line
      <br />
      second line
    </Text>
    <Text>
      {md`
        - raw markdown
        - keeps its newlines
      `}
    </Text>
    <Text>{items.map((i) => `- ${i}`).join("\n")}</Text>
  </>
)
```

Inside `<Text>`, adjacent text and `{expressions}` join into one block. `md` removes the indentation the lines share.

## Buttons and selects

`<Button style="primary" | "secondary" | "success" | "danger">` with `onClick`, `url` (link) or `skuId` (premium). `emoji` takes `"👍"`, `"<:name:id>"` or `{ id, name }`. Selects are `<StringSelect>` (with `options={Choices}` and/or `<Option>` children), `<UserSelect>`, `<RoleSelect>`, `<MentionableSelect>` and `<ChannelSelect>`, answered by `onSelect`. See [Handlers and Views](./views).

## Modals

A `<Modal>` holds 1-5 `<Label>`s (and `<Text>`). Each `<Label>` wraps exactly one input, and the input's `name` is its key in `onSubmit`'s values:

```tsx twoslash
import { Checkbox, Label, Modal, RadioGroup, TextInput } from "composurejs"
// ---cut---
export const Feedback = () => (
  <Modal title="Feedback" onSubmit={(c, v: { what: string; mood: string; notify: boolean }) => c.ephemeral(`Thanks! (${v.mood})`)}>
    <Label text="What happened?">
      <TextInput name="what" paragraph maxLength={500} />
    </Label>
    <Label text="How was it?">
      <RadioGroup name="mood" options={[{ name: "Good", value: "good" }, { name: "Bad", value: "bad" }]} />
    </Label>
    <Label text="Notify me">
      <Checkbox name="notify" />
    </Label>
  </Modal>
)
```

The other inputs are `<CheckboxGroup>`, `<FileUpload>` and the selects.

## Limits

Discord rejects a message that breaks its rules with a bare "This interaction failed", and logs nothing. composurejs checks every message when it renders and throws an error naming the rule instead:

- `<Container> cannot go inside <Container>`
- `text cannot go inside <Row>`
- `A <Row> holds at most 5 <Button>s, this one has 6`
- `custom_id "x" is used twice in one message (<Button> and <Button>)`
- `<Button> label is 81 characters; the limit is 80`
- `A message can hold at most 40 components`, and `at most 4000 characters of text`
- `Upload name "my file.txt" in <File> may only use letters, digits, "_", "-" and "."`
