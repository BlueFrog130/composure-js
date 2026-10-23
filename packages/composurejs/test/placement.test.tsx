// The static checks (composurejs/placement) and the render walk must agree: every built-in tag,
// text and <br /> is rendered inside every parent the table has rules for, and the walk must
// throw exactly the table's message, or no placement error at all.
import { describe, expect, test } from "vitest";
import {
  Button,
  ChannelSelect,
  Checkbox,
  CheckboxGroup,
  Container,
  File,
  FileUpload,
  Gallery,
  Item,
  Label,
  MentionableSelect,
  Message,
  Modal,
  Option,
  RadioGroup,
  render,
  RoleSelect,
  Row,
  Section,
  Separator,
  StringSelect,
  Text,
  TextInput,
  Thumbnail,
  UserSelect,
  type JSX,
} from "composurejs";
import * as components from "../src/components.ts";
import { accessoryError, PLACEMENT, placementError, TAGS, TEXT } from "../src/placement.ts";

type View = JSX.Element | string;

const CHILDREN: Record<string, () => View> = {
  [TEXT]: () => "hello",
  br: () => <br />,
  Message: () => <Message>m</Message>,
  Container: () => <Container>c</Container>,
  Section: () => <Section accessory={<Thumbnail src="https://x.test/s.png" />}>s</Section>,
  Text: () => <Text>t</Text>,
  Separator: () => <Separator />,
  Row: () => (
    <Row>
      <Button customId="row" label="r" />
    </Row>
  ),
  Thumbnail: () => <Thumbnail src="https://x.test/t.png" />,
  Gallery: () => (
    <Gallery>
      <Item src="https://x.test/g.png" />
    </Gallery>
  ),
  Item: () => <Item src="https://x.test/i.png" />,
  File: () => <File src="attachment://f.txt" />,
  Button: () => <Button customId="child" label="b" />,
  Option: () => <Option value="o">o</Option>,
  Modal: () => <Modal title="m">m</Modal>,
  Label: () => (
    <Label text="l">
      <TextInput name="l" />
    </Label>
  ),
  StringSelect: () => (
    <StringSelect customId="ss">
      <Option value="o">o</Option>
    </StringSelect>
  ),
  UserSelect: () => <UserSelect customId="us" />,
  RoleSelect: () => <RoleSelect customId="rs" />,
  MentionableSelect: () => <MentionableSelect customId="ms" />,
  ChannelSelect: () => <ChannelSelect customId="cs" />,
  TextInput: () => <TextInput name="ti" />,
  RadioGroup: () => <RadioGroup name="rg" options={[{ name: "a", value: "a" }]} />,
  CheckboxGroup: () => <CheckboxGroup name="cg" options={[{ name: "a", value: "a" }]} />,
  Checkbox: () => <Checkbox name="cb" />,
  FileUpload: () => <FileUpload name="fu" />,
};

const modal = (input: JSX.Element) => (
  <Modal title="t" customId="modal">
    <Label text="l">{input}</Label>
  </Modal>
);

/** Each parent holding `c`, itself placed where it may go. Labels are left out so children count. */
const PARENTS: Record<string, (c: View) => JSX.Element> = {
  Message: (c) => <Message>{c}</Message>,
  Container: (c) => <Container>{c}</Container>,
  Section: (c) => <Section accessory={<Button customId="acc" label="a" />}>{c}</Section>,
  Text: (c) => <Text>{c}</Text>,
  Button: (c) => (
    <Row>
      <Button customId="parent">{c}</Button>
    </Row>
  ),
  Option: (c) => (
    <Row>
      <StringSelect customId="parent">
        <Option value="parent">{c}</Option>
      </StringSelect>
    </Row>
  ),
  Row: (c) => <Row>{c}</Row>,
  StringSelect: (c) => (
    <Row>
      <StringSelect customId="parent">{c}</StringSelect>
    </Row>
  ),
  RadioGroup: (c) => modal(<RadioGroup name="parent">{c}</RadioGroup>),
  CheckboxGroup: (c) => modal(<CheckboxGroup name="parent">{c}</CheckboxGroup>),
  Gallery: (c) => <Gallery>{c}</Gallery>,
  Modal: (c) => (
    <Modal title="t" customId="modal">
      {c}
    </Modal>
  ),
  Label: (c) => (
    <Modal title="t" customId="modal">
      <Label text="l">{c}</Label>
    </Modal>
  ),
};

const PLACEMENT_ERROR = /cannot go|can only be the root|goes in|accessory/;
const errorOf = (view: JSX.Element) =>
  render(view).then(
    () => undefined,
    (e: Error) => e.message,
  );
const kinds = [TEXT, "br", ...TAGS];

test("TAGS lists every built-in tag", () => {
  const exported = Object.entries(components)
    .filter(([name, value]) => /^[A-Z]/.test(name) && typeof value === "function")
    .map(([name]) => name);
  expect([...TAGS].sort()).toEqual(exported.sort());
  expect(Object.keys(PARENTS).sort()).toEqual(Object.keys(PLACEMENT).sort());
});

describe.each(Object.keys(PLACEMENT))("inside <%s>", (parent) => {
  test.each(kinds)("%s", async (kind) => {
    const expected = placementError(parent, kind);
    const error = await errorOf(PARENTS[parent]!(CHILDREN[kind]!()));
    if (expected) expect(error).toBe(expected);
    else expect(error ?? "").not.toMatch(PLACEMENT_ERROR);
  });
});

describe("<Section accessory>", () => {
  test.each(kinds)("%s", async (kind) => {
    const expected = accessoryError(kind);
    const error = await errorOf(<Section accessory={CHILDREN[kind]!() as JSX.Element}>s</Section>);
    if (expected) expect(error).toBe(expected);
    else expect(error ?? "").not.toMatch(PLACEMENT_ERROR);
  });
});
