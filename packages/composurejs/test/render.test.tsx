import { describe, expect, test } from "vitest"
import {
  Button,
  ChannelSelect,
  Checkbox,
  CheckboxGroup,
  Container,
  defineChoices,
  File,
  FileUpload,
  Gallery,
  Item,
  Label,
  md,
  MentionableSelect,
  Message,
  Modal,
  Option,
  RadioGroup,
  render,
  RenderError,
  RoleSelect,
  Row,
  Section,
  Separator,
  StringSelect,
  Text,
  TextInput,
  Thumbnail,
  upload,
  UserSelect,
  type JSX,
} from "composurejs"
import { renderMessage } from "../src/jsx/render.ts"

const components = async (view: JSX.Element) => (await renderMessage(view)).data.components
const fails = (view: JSX.Element, message: string | RegExp) => expect(render(view)).rejects.toThrow(message)

describe("text", () => {
  test("adjacent text and expressions join into one Text Display", async () => {
    const name = "Alice"
    expect(await components(<Text>Hi {name}, you have {3} cookies</Text>)).toEqual([{ type: 10, content: "Hi Alice, you have 3 cookies" }])
  })

  test("JSX drops newlines; <br /> puts them back", async () => {
    const view = (
      <Text>
        - one
        <br />- two
      </Text>
    )
    expect(await components(view)).toEqual([{ type: 10, content: "- one\n- two" }])
  })

  test("md keeps raw markdown, dedented; interpolations do not change the indent", async () => {
    const list = "a\n  b"
    const view = (
      <Text>
        {md`
          ## Title
          - ${list}
            - nested
        `}
      </Text>
    )
    expect(await components(view)).toEqual([{ type: 10, content: "## Title\n- a\n  b\n  - nested" }])
  })

  test("content prop, and bare text at the top joins into a Text Display", async () => {
    expect(await components(<>{"one "}{2}<Text content="three" /></>)).toEqual([
      { type: 10, content: "one 2" },
      { type: 10, content: "three" },
    ])
  })

  test("null, false, undefined render nothing; arrays, fragments and async Views flatten", async () => {
    const Async = async ({ n }: { n: number }) => <Text>async {n}</Text>
    const view = (
      <Container>
        {null}
        {false}
        {undefined}
        {["a", "b"].map((x) => (
          <Text>{x}</Text>
        ))}
        <>
          <Text>frag</Text>
        </>
        <Async n={1} />
      </Container>
    )
    const [container] = (await components(view)) as unknown as [{ components: unknown[] }]
    expect(container.components).toEqual([
      { type: 10, content: "a" },
      { type: 10, content: "b" },
      { type: 10, content: "frag" },
      { type: 10, content: "async 1" },
    ])
  })
})

describe("component JSON", () => {
  test("Container, Separator, Section with Thumbnail and Button accessories", async () => {
    const view = (
      <Container accentColor={0xff0000} spoiler id={7}>
        <Section accessory={<Thumbnail src="https://img.test/a.png" description="A" />}>
          <Text>## Title</Text>
          Subtitle
        </Section>
        <Separator divider={false} spacing="large" />
        <Section accessory={<Button customId="more" style="primary">More</Button>}>Text</Section>
      </Container>
    )
    expect(await components(view)).toEqual([
      {
        type: 17,
        id: 7,
        accent_color: 0xff0000,
        spoiler: true,
        components: [
          {
            type: 9,
            components: [
              { type: 10, content: "## Title" },
              { type: 10, content: "Subtitle" },
            ],
            accessory: { type: 11, media: { url: "https://img.test/a.png" }, description: "A" },
          },
          { type: 14, divider: false, spacing: 2 },
          { type: 9, components: [{ type: 10, content: "Text" }], accessory: { type: 2, style: 1, custom_id: "more", label: "More" } },
        ],
      },
    ])
  })

  test("Buttons: styles, link, premium, emoji forms, disabled", async () => {
    const view = (
      <Row>
        <Button customId="a">Grey</Button>
        <Button customId="b" style="danger" emoji="🗑️" disabled />
        <Button customId="c" style="success" emoji="<a:party:123>" label="Party" />
        <Button url="https://example.com">Docs</Button>
        <Button skuId="999" />
      </Row>
    )
    expect(await components(view)).toEqual([
      {
        type: 1,
        components: [
          { type: 2, style: 2, custom_id: "a", label: "Grey" },
          { type: 2, style: 4, custom_id: "b", emoji: { name: "🗑️" }, disabled: true },
          { type: 2, style: 3, custom_id: "c", label: "Party", emoji: { id: "123", name: "party", animated: true } },
          { type: 2, style: 5, url: "https://example.com", label: "Docs" },
          { type: 2, style: 6, sku_id: "999" },
        ],
      },
    ])
  })

  test("selects: string options from Choices and <Option>s; entity defaults; channel types", async () => {
    const Flavor = defineChoices({ choc: "Chocolate" })
    const view = (
      <>
        <Row>
          <StringSelect customId="flavor" placeholder="Pick" minValues={1} maxValues={2} options={Flavor}>
            <Option value="oat" description="Chewy" emoji="🍪" default>
              Oatmeal
            </Option>
          </StringSelect>
        </Row>
        <Row>
          <UserSelect customId="u" defaultValues={["1"]} />
        </Row>
        <Row>
          <RoleSelect customId="r" />
        </Row>
        <Row>
          <MentionableSelect customId="m" defaultValues={[{ id: "2", type: "role" }]} />
        </Row>
        <Row>
          <ChannelSelect customId="c" channelTypes={[0]} maxValues={3} />
        </Row>
      </>
    )
    const rows = (await components(view)) as unknown as { components: unknown[] }[]
    expect(rows.map((r) => r.components[0])).toEqual([
      {
        type: 3,
        custom_id: "flavor",
        placeholder: "Pick",
        min_values: 1,
        max_values: 2,
        options: [
          { label: "Chocolate", value: "choc" },
          { label: "Oatmeal", value: "oat", description: "Chewy", emoji: { name: "🍪" }, default: true },
        ],
      },
      { type: 5, custom_id: "u", default_values: [{ id: "1", type: "user" }] },
      { type: 6, custom_id: "r" },
      { type: 7, custom_id: "m", default_values: [{ id: "2", type: "role" }] },
      { type: 8, custom_id: "c", channel_types: [0], max_values: 3 },
    ])
  })

  test("Uploads attach once and are referenced as attachment://", async () => {
    const chart = upload("chart.png", new Uint8Array([1, 2, 3]), { contentType: "image/png" })
    const report = upload("report.txt", "hello")
    const rendered = await renderMessage(
      <>
        <Gallery>
          <Item src={chart} description="Chart" />
          <Item src="https://img.test/b.png" spoiler />
        </Gallery>
        <Section accessory={<Thumbnail src={chart} />}>Same file, once</Section>
        <File src={report} spoiler />
        <File src="attachment://elsewhere.zip" />
      </>,
    )
    expect(rendered.data.components).toEqual([
      { type: 12, items: [{ media: { url: "attachment://chart.png" }, description: "Chart" }, { media: { url: "https://img.test/b.png" }, spoiler: true }] },
      { type: 9, components: [{ type: 10, content: "Same file, once" }], accessory: { type: 11, media: { url: "attachment://chart.png" } } },
      { type: 13, file: { url: "attachment://report.txt" }, spoiler: true },
      { type: 13, file: { url: "attachment://elsewhere.zip" } },
    ])
    expect(rendered.files).toEqual([chart, report])
  })

  test("<Message> sets ephemeral, notifications and allowed mentions", async () => {
    const rendered = await renderMessage(
      <Message ephemeral suppressNotifications allowedMentions={{ users: ["1"], repliedUser: false }}>
        <Text>Hi {"<@1>"}</Text>
      </Message>,
    )
    expect(rendered.data).toEqual({
      flags: (1 << 15) | (1 << 6) | (1 << 12),
      components: [{ type: 10, content: "Hi <@1>" }],
      allowed_mentions: { parse: [], users: ["1"], replied_user: false },
    })
  })

  test("a <Modal> root renders a modal with Labels around inputs", async () => {
    const Severity = defineChoices({ low: "Low", high: "High" })
    const rendered = await render(
      <Modal title="Report" customId="report">
        <Text>Reporting **page**</Text>
        <Label text="What happened?" description="Be brief">
          <TextInput name="what" paragraph maxLength={500} placeholder="..." />
        </Label>
        <Label text="Severity">
          <RadioGroup name="severity" options={Severity} />
        </Label>
        <Label text="Areas">
          <CheckboxGroup name="areas" minValues={0} maxValues={2}>
            <Option value="ui">UI</Option>
            <Option value="api">API</Option>
          </CheckboxGroup>
        </Label>
        <Label text="Notify me">
          <Checkbox name="notify" default />
        </Label>
        <Label text="Screenshot">
          <FileUpload name="shot" maxValues={2} fileTypes={["image"]} required={false} />
        </Label>
      </Modal>,
    ).catch((e: unknown) => e)
    // 6 components: one over the limit of 5.
    expect(rendered).toEqual(new RenderError("A <Modal> holds 1-5 <Label>s and <Text>s, it has 6"))

    const ok = await render(
      <Modal title="Report" customId="report">
        <Label text="What happened?" description="Be brief">
          <TextInput name="what" paragraph maxLength={500} placeholder="..." />
        </Label>
        <Label text="Severity">
          <RadioGroup name="severity" options={Severity} />
        </Label>
        <Label text="Areas">
          <CheckboxGroup name="areas" minValues={0} maxValues={2}>
            <Option value="ui">UI</Option>
            <Option value="api">API</Option>
          </CheckboxGroup>
        </Label>
        <Label text="Notify me">
          <Checkbox name="notify" default />
        </Label>
        <Label text="Screenshot">
          <FileUpload name="shot" maxValues={2} fileTypes={["image"]} required={false} />
        </Label>
      </Modal>,
    )
    expect(ok).toEqual({
      kind: "modal",
      data: {
        custom_id: "report",
        title: "Report",
        components: [
          { type: 18, label: "What happened?", description: "Be brief", component: { type: 4, custom_id: "what", style: 2, max_length: 500, placeholder: "..." } },
          { type: 18, label: "Severity", component: { type: 21, custom_id: "severity", options: [{ label: "Low", value: "low" }, { label: "High", value: "high" }] } },
          {
            type: 18,
            label: "Areas",
            component: { type: 22, custom_id: "areas", options: [{ label: "UI", value: "ui" }, { label: "API", value: "api" }], min_values: 0, max_values: 2 },
          },
          { type: 18, label: "Notify me", component: { type: 23, custom_id: "notify", default: true } },
          { type: 18, label: "Screenshot", component: { type: 19, custom_id: "shot", required: false, max_values: 2, file_types: ["image"] } },
        ],
      },
    })
  })
})

describe("placement errors name parent and child", () => {
  test.each([
    ["Container in Container", <Container><Container><Text>x</Text></Container></Container>, "<Container> cannot go inside <Container>"],
    ["tag in Text", <Text><Container /></Text>, "<Container> cannot go inside <Text>"],
    ["text in Row", <Row>hello</Row>, "text cannot go inside <Row>"],
    ["Button at top", <Button customId="x">x</Button>, "<Button> cannot go at the top of a message"],
    ["Button inside Section", <Section accessory={<Button customId="a">a</Button>}><Button customId="b">b</Button></Section>, "<Button> goes in <Section accessory={..}>, not inside <Section>"],
    ["Section without accessory", <Section accessory={null as never}>x</Section>, "<Section> needs exactly one accessory"],
    ["bad accessory", <Section accessory={<Text>x</Text>}>x</Section>, "<Text> cannot be a <Section> accessory"],
    ["4 texts in Section", <Section accessory={<Button customId="a">a</Button>}><Text>1</Text><Text>2</Text><Text>3</Text><Text>4</Text></Section>, "<Section> needs 1-3 blocks of text, it has 4"],
    ["select with buttons", <Row><Button customId="a">a</Button><UserSelect customId="u" /></Row>, "A <Row> holds up to 5 <Button>s or one select, not <Button> + <UserSelect>"],
    ["6 buttons", <Row>{[1, 2, 3, 4, 5, 6].map((i) => <Button customId={`b${i}`}>{i}</Button>)}</Row>, "A <Row> holds at most 5 <Button>s, this one has 6"],
    ["Message nested", <Container><Message><Text>x</Text></Message></Container>, "<Message> can only be the root of a View"],
    ["Modal nested", <Container><Modal title="t" customId="m" /></Container>, "<Modal> can only be the root of a View"],
    ["input outside Label", <Modal title="t" customId="m"><TextInput name="x" /></Modal>, "<TextInput> goes inside a <Label> in a <Modal>"],
    ["Label with two inputs", <Modal title="t" customId="m"><Label text="L"><TextInput name="a" /><TextInput name="b" /></Label></Modal>, '<Label> holds exactly one input, "L" has 2'],
    ["Text in Gallery", <Gallery><Text>x</Text></Gallery>, "<Text> cannot go inside <Gallery>"],
    ["Item outside Gallery", <Item src="x" />, "<Item> cannot go at the top of a message"],
    ["required in a message", <Row><StringSelect customId="s" required><Option value="a">a</Option></StringSelect></Row>, "<StringSelect> required only applies in modals"],
    ["required Checkbox", <Modal title="t" customId="m"><Label text="L"><Checkbox name="c" {...({ required: true } as {})} /></Label></Modal>, "<Checkbox> is never required"],
  ])("%s", async (_, view, message) => {
    await fails(view, message)
  })
})

describe("Limits are checked before Discord sees the message", () => {
  test.each([
    ["4000 characters of text", <Text>{"x".repeat(4001)}</Text>, "at most 4000 characters of text"],
    ["40 components", <>{Array.from({ length: 41 }, (_, i) => <Text>{i}</Text>)}</>, "at most 40 components, this View has 41"],
    ["nothing", <>{null}</>, "renders no components"],
    ["empty Text", <Text>{"  "}</Text>, "<Text> is empty"],
    ["100-character custom_id", <Row><Button customId={"x".repeat(101)}>x</Button></Row>, /custom_id is 101 characters; the limit is 100\. Carry an id/],
    ["80-character label", <Row><Button customId="x">{"x".repeat(81)}</Button></Row>, "<Button> label is 81 characters; the limit is 80"],
    ["duplicate custom_id", <><Row><Button customId="x">a</Button></Row><Row><Button customId="x">b</Button></Row></>, 'custom_id "x" is used twice in one message (<Button> and <Button>)'],
    ["button without id", <Row><Button>x</Button></Row>, "<Button> needs a customId"],
    ["button without label", <Row><Button customId="x" /></Row>, "<Button> needs a label or an emoji"],
    ["link with custom_id", <Row><Button url="https://x.test" customId="x">x</Button></Row>, "A link <Button> (url) cannot have a customId"],
    ["26 options", <Row><StringSelect customId="s">{Array.from({ length: 26 }, (_, i) => <Option value={`v${i}`}>{i}</Option>)}</StringSelect></Row>, "<StringSelect> needs 1-25 options, it has 26"],
    ["duplicate option value", <Row><StringSelect customId="s"><Option value="a">A</Option><Option value="a">B</Option></StringSelect></Row>, '<StringSelect> has two options with value "a"'],
    ["maxValues over options", <Row><StringSelect customId="s" maxValues={3}><Option value="a">A</Option></StringSelect></Row>, "<StringSelect> maxValues must be 1-1"],
    ["11 gallery items", <Gallery>{Array.from({ length: 11 }, (_, i) => <Item src={`https://x.test/${i}`} />)}</Gallery>, "<Gallery> needs 1-10 <Item>s, it has 11"],
    ["upload name", <File src={upload("my file.txt", "x")} />, 'Upload name "my file.txt" in <File> may only use letters'],
    ["two uploads, one name", <><File src={upload("a.txt", "1")} /><File src={upload("a.txt", "2")} /></>, 'Two different Uploads are named "a.txt"'],
    ["11 files", <>{Array.from({ length: 11 }, (_, i) => <File src={upload(`f${i}.txt`, "x")} />)}</>, "at most 10 files, this View has 11"],
    ["File with a URL", <File src={"https://x.test/a" as never} />, "<File> src must be an Upload or attachment://<name>"],
    ["modal title", <Modal title={"x".repeat(46)} customId="m"><Text>x</Text></Modal>, "<Modal> title is 46 characters; the limit is 45"],
    ["text input length", <Modal title="t" customId="m"><Label text="L"><TextInput name="a" maxLength={4001} /></Label></Modal>, "<TextInput> maxLength must be 1-4000"],
  ])("%s", async (_, view, message) => {
    await fails(view, message)
  })
})
