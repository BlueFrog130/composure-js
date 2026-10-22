import { describe, expect, expectTypeOf, test } from "vitest"
import {
  App,
  AppConfigError,
  Button,
  Checkbox,
  command,
  component,
  Container,
  defineChoices,
  Ephemeral,
  f,
  Label,
  type LogEntry,
  type Logger,
  Modal,
  modal,
  Option,
  p,
  RadioGroup,
  Row,
  StringSelect,
  Text,
  TextInput,
  view,
} from "composurejs"
import { answer, command as invoke, component as click } from "composurejs/testing"
// Imported by path, so @composurejs/vite does not hoist it: stands in for a build without the plugin.
import { view as unhoistedView } from "../src/handlers.ts"

function recordingLogger() {
  const entries: (LogEntry & { level: string })[] = []
  const at = (level: string) => (entry: LogEntry) => void entries.push({ level, ...entry })
  const logger: Logger = { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") }
  return { logger, entries }
}

export const Card = view("card", {
  props: { title: p.string(), likes: p.int() },
  render: ({ title, likes }, on) => (
    <Container>
      <Text>## {title}</Text>
      <Text>-# {likes} likes</Text>
      <Row>
        <Button style="primary" onClick={on("like", () => Card({ title, likes: likes + 1 }))}>Like</Button>
        <Button onClick={on("who", (c) => c.ephemeral(`You are ${c.user.username}`))}>Who am I?</Button>
      </Row>
    </Container>
  ),
})

const cardCommand = command({ name: "card", description: "Card", handler: () => <Card title="Cookies" likes={0} /> })

describe("Views with Inline Handlers", () => {
  const app = new App().command(cardCommand).view(Card)

  test("a click re-renders from new Props (Update), carrying only what the handler captures", async () => {
    const first = await answer(app, invoke("card"))
    expect(first.text).toBe("## Cookies\n-# 0 likes")
    expect(first.component("card:like:Cookies:0")).toMatchObject({ label: "Like" })
    expect(first.component("card:who")).toMatchObject({ label: "Who am I?" })

    const second = await answer(app, first.click("Like"))
    expect(second.type).toBe(7)
    expect(second.text).toBe("## Cookies\n-# 1 likes")
    const third = await answer(app, second.click("Like"))
    expect(third.text).toBe("## Cookies\n-# 2 likes")
  })

  test("a handler returning something else answers as a Command would", async () => {
    const res = await answer(app, (await answer(app, invoke("card"))).click("Who am I?"))
    expect([res.type, res.text, res.isEphemeral]).toEqual([4, "You are alice", true])
  })

  test("Props in custom_ids are escaped", async () => {
    const res = await answer(new App().command(command({ name: "c", description: "C", handler: () => <Card title={"a:b\\c"} likes={1} /> })).view(Card), invoke("c"))
    expect(res.component("card:like:a\\:b\\\\c:1")).toBeDefined()
    expect((await answer(app, res.click("Like"))).text).toBe("## a:b\\c\n-# 2 likes")
  })

  test("outdated ids go to the Fallback: unknown name, bad state, unknown prefix", async () => {
    for (const id of ["card:gone", "card:like:Cookies:notanint", "card:like:Cookies", "nobody:x", "card:like:a\\"]) {
      const res = await answer(app, click(id))
      expect([id, res.text, res.isEphemeral]).toEqual([id, "This message is outdated.", true])
    }
  })

  test("loop variables are captured by member chain", async () => {
    const items = [
      { id: "a1", name: "Apple", meta: { stock: 3 } },
      { id: "b2", name: "Bread", meta: { stock: 0 } },
    ]
    const Shop = view("shop", {
      props: { shop: p.string() },
      render: ({ shop }, on) => (
        <Row>
          {items.map((item) => (
            <Button onClick={on("buy", () => `${shop}: ${item.name} (${item.id}), ${item.meta.stock} left`)}>{item.name}</Button>
          ))}
        </Row>
      ),
    })
    const shopApp = new App().command(command({ name: "shop", description: "Shop", handler: () => <Shop shop="corner" /> })).view(Shop)
    const res = await answer(shopApp, invoke("shop"))
    expect(res.allComponents.filter((c) => c.type === 2).map((c) => c.custom_id)).toEqual(["shop:buy:corner:sa1:sApple:n3", "shop:buy:corner:sb2:sBread:n0"])
    expect((await answer(shopApp, res.click("Bread"))).text).toBe("corner: Bread (b2), 0 left")
  })

  test("capturing an object throws at render, naming what to capture instead", async () => {
    const { logger, entries } = recordingLogger()
    const Bad = view("bad", {
      render: (_, on) => {
        const user = { id: "1" }
        return <Row><Button onClick={on("x", () => JSON.stringify(user))}>x</Button></Row>
      },
    })
    await answer(new App({ logger }).command(command({ name: "bad", description: "Bad", handler: () => <Bad /> })).view(Bad), invoke("bad"))
    expect((entries[0]?.error as Error).message).toBe("Handler \"x\" in View \"bad\" captures `user`, which is an object; capture a string, number or boolean from it, like `user.id`")
  })

  test("selects pass their values", async () => {
    const Toppings = defineChoices({ nuts: "Nuts", salt: "Sea salt", icing: "Icing" })
    const Picker = view("picker", {
      render: (_, on) => (
        <Row>
          <StringSelect maxValues={3} options={Toppings} onSelect={on("pick", (_c, values: ("nuts" | "salt" | "icing")[]) => `picked ${values.join("+")}`)} />
        </Row>
      ),
    })
    const pickerApp = new App().command(command({ name: "pick", description: "Pick", handler: () => <Picker /> })).view(Picker)
    const res = await answer(pickerApp, invoke("pick"))
    expect((await answer(pickerApp, res.select("picker:pick", ["salt", "icing"]))).text).toBe("picked salt+icing")
  })

  test("a View with handlers must be listed in the App", async () => {
    const { logger, entries } = recordingLogger()
    const res = await answer(new App({ logger }).command(cardCommand), invoke("card"))
    expect(res.text).toBe("Something went wrong.")
    expect((entries[0]?.error as Error).message).toBe('View "card" places Inline Handlers but is not listed in the App; add app.view(..) for it')
  })

  test("Props that make a custom_id too long fail at render with a hint", async () => {
    const { logger, entries } = recordingLogger()
    const long = new App({ logger }).command(command({ name: "c", description: "C", handler: () => <Card title={"x".repeat(100)} likes={1} /> })).view(Card)
    await answer(long, invoke("c"))
    expect((entries[0]?.error as Error).message).toMatch(/custom_id is 112 characters; the limit is 100\. Carry an id and load the rest instead/)
  })

  test("missing Props are an error", async () => {
    const { logger, entries } = recordingLogger()
    const app2 = new App({ logger }).command(command({ name: "c", description: "C", handler: () => Card({ title: "x" } as never) })).view(Card)
    await answer(app2, invoke("c"))
    expect((entries[0]?.error as Error).message).toBe('View "card" is missing prop "likes"')
  })

  test("async render can load data from small Props", async () => {
    const db = new Map([["42", { name: "Ada", score: 7 }]])
    const Profile = view("profile", {
      props: { id: p.string() },
      render: async ({ id }, on) => {
        const row = db.get(id)!
        return (
          <Row>
            <Button onClick={on("bump", () => ((db.get(id)!.score += 1), Profile({ id })))}>{`${row.name}: ${row.score}`}</Button>
          </Row>
        )
      },
    })
    const profileApp = new App().command(command({ name: "p", description: "P", handler: () => <Profile id="42" /> })).view(Profile)
    const res = await answer(profileApp, invoke("p"))
    expect(res.component("profile:bump:42")).toMatchObject({ label: "Ada: 7" })
    expect((await answer(profileApp, res.click("profile:bump:42"))).component("profile:bump:42")).toMatchObject({ label: "Ada: 8" })
  })

  test("without the plugin, on() throws at render and says how to fix it", async () => {
    const { logger, entries } = recordingLogger()
    const Plain = unhoistedView("plain", { render: (_, on) => <Row><Button onClick={on("x", () => "hi")}>x</Button></Row> })
    await answer(new App({ logger }).command(command({ name: "plain", description: "P", handler: () => <Plain /> })).view(Plain), invoke("plain"))
    expect((entries[0]?.error as Error).message).toMatch(/^View "plain", handler "x": Inline Handlers need the @composurejs\/vite plugin/)
  })
})

describe("Component Handlers", () => {
  const vote = component("vote", {
    state: { poll: p.snowflake(), up: p.bool() },
    handler: (c, { poll, up }) => {
      expectTypeOf(poll).toEqualTypeOf<string>()
      return Ephemeral(`${c.user.username} voted ${up ? "up" : "down"} on ${poll}`)
    },
  })
  const poll = command({
    name: "poll",
    description: "Poll",
    handler: () => (
      <Row>
        <Button onClick={vote.id({ poll: "123", up: true })}>👍</Button>
        <Button customId={vote.id({ poll: "123", up: false })}>👎</Button>
      </Row>
    ),
  })
  const app = new App().command(poll).component(vote)

  test("are placed with .id(state) and get typed state", async () => {
    const res = await answer(app, invoke("poll"))
    expect(res.components[0]).toMatchObject({ components: [{ custom_id: "vote:123:1" }, { custom_id: "vote:123:0" }] })
    expect((await answer(app, res.click("vote:123:0"))).text).toBe("alice voted down on 123")
  })

  test("state that does not decode goes to the Fallback", async () => {
    expect((await answer(app, click("vote:abc:1"))).text).toBe("This message is outdated.")
    expect((await answer(app, click("vote:123:1:extra"))).text).toBe("This message is outdated.")
  })

  test("a handler without state has the prefix as its id; it receives select values", async () => {
    const pick = component("pick", { handler: (_c, _state, values) => `got ${values.join(",")}` })
    expect(pick.id()).toBe("pick")
    expect((await answer(new App().component(pick), click("pick").values(["a", "b"]))).text).toBe("got a,b")
  })

  test("prefixes are unique across the tree, and must be simple", () => {
    const again = component("vote", { handler: () => "x" })
    expect(() => new App().component(vote).route(new App().view(view("vote", { render: () => null }))).check()).toThrow(
      'custom_id prefix "vote" is used twice: at app.route[0] and at app.route[1].route[0]',
    )
    expect(() => new App().component(vote).component(again).check()).toThrow(AppConfigError)
    expect(() => component("a:b", { handler: () => "x" })).toThrow('prefix "a:b" must be 1-32 letters')
  })

  test("middleware of the listing App wraps them", async () => {
    const seen: string[] = []
    const inner = new App().use((c, next) => (seen.push((c.interaction as { data: { custom_id: string } }).data.custom_id), next())).component(vote)
    await answer(new App().command(poll).route(inner), click("vote:1:1"))
    expect(seen).toEqual(["vote:1:1"])
  })
})

describe("Modal Handlers and fields", () => {
  const Severity = defineChoices({ low: "Low", high: "High" })
  const feedback = modal("feedback", {
    state: { page: p.string() },
    fields: { what: f.text({ paragraph: true, maxLength: 500 }), severity: f.choice(Severity), notify: f.checkbox(), extra: f.text().optional() },
    render: ({ page }, fields) => (
      <Modal title={`Feedback on ${page}`}>
        <Label text="What happened?">
          <TextInput field={fields.what} />
        </Label>
        <Label text="Severity">
          <RadioGroup field={fields.severity} />
        </Label>
        <Label text="Notify me">
          <Checkbox field={fields.notify} />
        </Label>
        <Label text="Anything else?">
          <TextInput field={fields.extra} />
        </Label>
      </Modal>
    ),
    handler: (c, values, { page }) => {
      expectTypeOf(values).toEqualTypeOf<{ what: string; severity: "low" | "high"; notify: boolean; extra: string | undefined }>()
      return Ephemeral(`${page}: ${values.what} (${values.severity}, notify: ${values.notify}, extra: ${values.extra ?? "-"})`)
    },
  })
  const app = new App().command(command({ name: "feedback", description: "F", handler: () => feedback.open({ page: "home" }) })).modal(feedback)

  test("open renders the modal with fields bound, and submits get typed values", async () => {
    const res = await answer(app, invoke("feedback"))
    expect(res.type).toBe(9)
    expect(res.data).toMatchObject({ custom_id: "feedback:home", title: "Feedback on home" })
    expect(res.component("what")).toEqual({ type: 4, custom_id: "what", style: 2, max_length: 500, required: true })
    expect(res.component("severity")).toMatchObject({ type: 21, required: true, options: [{ label: "Low", value: "low" }, { label: "High", value: "high" }] })
    expect(res.component("notify")).toEqual({ type: 23, custom_id: "notify" })
    expect(res.component("extra")).toMatchObject({ required: false })

    const submitted = await answer(app, res.submit({ what: "It broke", severity: "high", notify: true }))
    expect(submitted.text).toBe("home: It broke (high, notify: true, extra: -)")
  })

  test("a submission that does not match the fields goes to the Fallback", async () => {
    const res = await answer(app, invoke("feedback"))
    expect((await answer(app, res.submit({ what: "x", severity: "medium" }))).text).toBe("This message is outdated.")
    expect((await answer(app, res.submit({ severity: "low" }))).text).toBe("This message is outdated.")
  })

  test("every field needs exactly one input, every input a field, of a matching kind", async () => {
    const { logger, entries } = recordingLogger()
    const fields = { a: f.text(), b: f.checkbox() }
    const cases = [
      ["missing", (r: Record<keyof typeof fields, never>) => <Modal title="t"><Label text="A"><TextInput field={r.a} /></Label></Modal>],
      ["extra", (r: Record<keyof typeof fields, never>) => <Modal title="t"><Label text="A"><TextInput field={r.a} /></Label><Label text="B"><Checkbox field={r.b} /></Label><Label text="C"><TextInput customId="c" /></Label></Modal>],
      ["kind", (r: Record<keyof typeof fields, never>) => <Modal title="t"><Label text="A"><Checkbox field={r.a} /></Label><Label text="B"><Checkbox field={r.b} /></Label></Modal>],
    ] as const
    for (const [name, render] of cases) {
      const m = modal(`m${name}`, { fields, render: (_, r) => render(r as never), handler: () => "x" })
      await answer(new App({ logger }).command(command({ name, description: "x", handler: () => m.open() })).modal(m), invoke(name))
    }
    expect(entries.map((e) => (e.error as Error).message)).toEqual([
      'Field "b" of modal "mmissing" has no input; bind one with field={fields.b}',
      'Input "c" in modal "mextra" is not one of its fields (a, b)',
      'Field "a" (text) cannot bind <Checkbox>; use <TextInput>',
    ])
  })

  test("field= sets customId and required; neither may be given too", async () => {
    const { logger, entries } = recordingLogger()
    const fields = { a: f.text() }
    const m = modal("m", { fields, render: (_, r) => <Modal title="t"><Label text="A"><TextInput field={r.a} required={false} /></Label></Modal>, handler: () => "x" })
    await answer(new App({ logger }).command(command({ name: "m", description: "x", handler: () => m.open() })).modal(m), invoke("m"))
    expect((entries[0]?.error as Error).message).toBe('<TextInput> gets required from field "a"; use .optional() on the field')
  })
})

describe("modal Views", () => {
  const Report = view("report", {
    props: { title: p.string(), likes: p.int() },
    fields: { reason: f.text() },
    render: ({ title, likes }, on, fields) => (
      <Modal title="Report" onSubmit={on("send", (_c, values) => Card({ title: `${title} (reported: ${values.reason})`, likes }))}>
        <Label text="Why?">
          <TextInput field={fields.reason} />
        </Label>
      </Modal>
    ),
  })
  const Reportable = view("reportable", {
    props: { title: p.string() },
    render: ({ title }, on) => (
      <Row>
        <Button onClick={on("report", () => Report({ title, likes: 5 }))}>Report</Button>
      </Row>
    ),
  })
  const app = new App()
    .command(command({ name: "r", description: "R", handler: () => <Reportable title="Post" /> }))
    .view(Reportable)
    .view(Report)
    .view(Card)

  test("a button opens a modal View; its submit re-renders the message it came from", async () => {
    const message = await answer(app, invoke("r"))
    const opened = await answer(app, message.click("Report"))
    expect(opened.type).toBe(9)
    expect(opened.data).toMatchObject({ custom_id: "report:send:Post:5" })
    const submitted = await answer(app, opened.submit({ reason: "spam" }))
    expect(submitted.type).toBe(7)
    expect(submitted.text).toBe("## Post (reported: spam)\n-# 5 likes")
  })

  test("a modal View opened by a Command answers its submit with a new message", async () => {
    const direct = new App().command(command({ name: "d", description: "D", handler: () => <Report title="Direct" likes={0} /> })).view(Report).view(Card)
    const opened = await answer(direct, invoke("d"))
    const submitted = await answer(direct, opened.submit({ reason: "why not" }))
    expect(submitted.type).toBe(4)
    expect(submitted.text).toBe("## Direct (reported: why not)\n-# 0 likes")
  })
})

test("options from shared Choices also work as <Option> children in Views", async () => {
  const V = view("opts", { render: () => <Row><StringSelect customId="s"><Option value="a">A</Option></StringSelect></Row> })
  const res = await answer(new App().command(command({ name: "o", description: "O", handler: () => <V /> })), invoke("o"))
  expect(res.component("s")).toMatchObject({ options: [{ label: "A", value: "a" }] })
})
