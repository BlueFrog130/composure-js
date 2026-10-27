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

Call `await render(view)` in a test to run the same checks before deploying.

## Placement

TypeScript can't check where a tag goes, because it gives every JSX expression the same type. So placement is checked twice before render: by the Vite plugin when it builds, and by a lint rule in your editor. Both report a built-in tag that ends up inside a parent that can't hold it. They follow children through fragments, `&&`, `? :`, arrays and `.map(..)`, and through your function components, in the same file or imported from a relative path:

```tsx
// ui.tsx
export const Card = ({ children }) => <Container>{children}</Container>

// shop.tsx
<Card>
  <Button customId="buy">Buy</Button> {/* <Button> cannot go inside <Container> (in <Card>) */}
</Card>
```

What a function component renders is checked against where you place it too (`<Row><Card /></Row>`: `<Container> cannot go inside <Row> (rendered by <Card>)`). A tag passed through a variable, or a component from a package, is still caught when the View renders. The lint rule reads imported files as saved on disk.

`vite dev` and `vite build` warn with the file and line:

```
[plugin composurejs] src/views/shop.tsx:12:7: <Button> cannot go inside <Container>
```

Turn it off with `composure({ placement: false })`.

For editor feedback, add `@composurejs/eslint-plugin`. With ESLint:

```js
// eslint.config.js
import composure from "@composurejs/eslint-plugin"

export default [composure.configs.recommended]
```

ESLint needs a TypeScript parser (such as `typescript-eslint`) for `.tsx` files. oxlint parses them itself and loads the same plugin:

```json
// .oxlintrc.json
{
  "jsPlugins": ["@composurejs/eslint-plugin"],
  "rules": { "@composurejs/placement": "error" }
}
```

The lint rule, the build warnings and render share one set of rules from `composurejs`, so they report the same mistakes with the same message.
