// Inline Handlers (ADR 0015), compiled by @composurejs/vite through vitest.config.ts exactly as in
// a bot's build. Components a handler renders live at module scope, as the plugin requires.
import { describe, expect, expectTypeOf, test } from "vitest";
import {
  App,
  Button,
  Checkbox,
  type ClickHandler,
  type ComponentContext,
  command,
  Container,
  defineChoices,
  Label,
  type LogEntry,
  type Logger,
  Modal,
  named,
  RadioGroup,
  Row,
  StringSelect,
  Text,
  TextInput,
} from "composurejs";
import { jsx } from "composurejs/jsx-runtime";
import { answer, chatInput, component as click } from "composurejs/testing";
// By path, so the plugin leaves them alone: stand-ins for a build without it.
import { Button as RawButton } from "../src/components.ts";
import { __handler, named as rawNamed } from "../src/handlers.ts";

function recordingLogger() {
  const entries: (LogEntry & { level: string })[] = [];
  const at = (level: string) => (entry: LogEntry) => void entries.push({ level, ...entry });
  const logger: Logger = { debug() {}, info() {}, warn: at("warn"), error: at("error") };
  return { logger, entries };
}

const ALICE = "100000000000000001";
const STEPS = [1, 5];

export const Counter = ({ count, owner }: { count: number; owner: string }) => (
  <Container>
    <Text>## Count: {count}</Text>
    <Row>
      {STEPS.map((step) => (
        <Button onClick={(c) => (c.user.id === owner ? <Counter count={count + step} owner={owner} /> : c.ephemeral("Not yours"))}>{`+${step}`}</Button>
      ))}
      <Button onClick={() => <Counter count={0} owner={owner} />}>Reset</Button>
    </Row>
  </Container>
);

/** A wrapper component passing its handler prop on. */
const Primary = ({ label, onClick }: { label: string; onClick: ClickHandler }) => (
  <Button style="primary" onClick={onClick}>
    {label}
  </Button>
);

function shout(c: ComponentContext) {
  return c.reply(`HEY ${c.user.username.toUpperCase()}`);
}

const Echo = ({ text }: { text: string }) => (
  <Row>
    <Button onClick={() => <Echo text={`${text}!`} />}>{text}</Button>
  </Row>
);

const scores = new Map([["42", { name: "Ada", score: 7 }]]);
const Profile = async ({ id }: { id: string }) => {
  const row = scores.get(id)!;
  return (
    <Row>
      <Button onClick={() => ((scores.get(id)!.score += 1), (<Profile id={id} />))}>{`${row.name}: ${row.score}`}</Button>
    </Row>
  );
};

let tallyCalls = 0;
/** Local handlers: a const, still callable, and a function declared after the return. */
const Tally = ({ n, owner }: { n: number; owner: string }) => {
  let shown = n;
  const add = (c: ComponentContext) => (c.user.id === owner ? <Tally n={shown + 1} owner={owner} /> : c.ephemeral("Not yours"));
  shown *= 10;
  tallyCalls += add({ user: { id: "nobody" }, ephemeral: () => 1 } as never) as unknown as number;
  return (
    <Row>
      <Button onClick={add}>add</Button>
      <Button onClick={reset}>reset</Button>
    </Row>
  );
  function reset() {
    return <Tally n={0} owner={owner} />;
  }
};

const Severity = defineChoices({ low: "Low", high: "High" });
type ReportValues = { what: string; severity: "low" | "high" | undefined; notify: boolean; extra: string | undefined };
const Report = ({ page }: { page: string }) => (
  <Modal title={`Report ${page}`} onSubmit={(c, v: ReportValues) => c.reply(`${page}: ${v.what} (${v.severity ?? "-"}, notify: ${v.notify}, extra: ${v.extra ?? "-"})`)}>
    <Label text="What happened?">
      <TextInput name="what" paragraph />
    </Label>
    <Label text="Severity">
      <RadioGroup name="severity" options={Severity} required={false} />
    </Label>
    <Label text="Notify me">
      <Checkbox name="notify" />
    </Label>
    <Label text="Anything else?">
      <TextInput name="extra" required={false} />
    </Label>
  </Modal>
);
const Reportable = ({ page }: { page: string }) => (
  <Row>
    <Button onClick={() => <Report page={page} />}>Report</Button>
  </Row>
);
const ThankYou = ({ page }: { page: string }) => <Text>Thanks for reporting {page}</Text>;
const Inline = ({ page }: { page: string }) => (
  <Row>
    <Button
      onClick={() => (
        <Modal title="Why?" onSubmit={(_c, v: { why: string }) => <ThankYou page={`${page} (${v.why})`} />}>
          <Label text="Why?">
            <TextInput name="why" />
          </Label>
        </Modal>
      )}
    >
      Report
    </Button>
  </Row>
);

const app = new App().command(command({ name: "counter", description: "Counter", handler: (c) => <Counter count={0} owner={c.user.id} /> }));

describe("Inline Handlers", () => {
  test("a click answers with markup that updates the message; no ids, no registration", async () => {
    const first = await answer(app, chatInput("counter"));
    expect(first.text).toBe("## Count: 0");
    const second = await answer(app, first.click("+5"));
    expect([second.type, second.text]).toEqual([7, "## Count: 5"]);
    const third = await answer(app, second.click("+1"));
    expect(third.text).toBe("## Count: 6");
    expect((await answer(app, third.click("Reset"))).text).toBe("## Count: 0");
  });

  test("custom_ids carry the Owning Route and the captured values, compactly: a snowflake in 13 characters", async () => {
    const res = await answer(app, chatInput("counter"));
    const ids = res.allComponents.filter((c) => c.type === 2).map((c) => c.custom_id as string);
    // The route, then owner, count, step: in the order the handler reads them.
    expect(ids[0]).toMatch(new RegExp(`^_[\\w-]{7}~[0-9a-z]{5}:i${BigInt(ALICE).toString(36)}:n0:n1$`));
    expect(ids[1]).toMatch(/:n5$/);
    expect(ids[2]).toMatch(/^_[\w-]{7}~[0-9a-z]{5}:i[0-9a-z]+$/);
    expect(Math.max(...ids.map((id) => id.length))).toBeLessThan(36);
  });

  test("handlers read the clicking user; other answers are new messages", async () => {
    const res = await answer(app, (await answer(app, chatInput("counter"))).click("+5").by({ id: "2" }));
    expect([res.type, res.text, res.isEphemeral]).toEqual([4, "Not yours", true]);
  });

  test("a command handler can place handlers inline, capturing from its c", async () => {
    const greet = new App().command(
      command({
        name: "greet",
        description: "Greet",
        handler: (c) => (
          <Row>
            <Button onClick={(b) => b.reply(`${b.user.username} waves back at ${c.user.username} in ${c.guildId ?? "DM"}`)}>Wave</Button>
          </Row>
        ),
      }),
    );
    const res = await answer(greet, chatInput("greet"));
    const waved = await answer(greet, res.click("Wave").by({ id: "2", username: "bob" }));
    expect([waved.type, waved.text]).toEqual([4, "bob waves back at alice in 798662131062931547"]);
  });

  test("handlers pass through wrapper components; module-level functions work as handlers", async () => {
    const app = new App().command(
      command({
        name: "wrapped",
        description: "Wrapped",
        handler: () => (
          <Row>
            <Primary label="Go" onClick={(c) => c.reply(`forwarded to ${c.user.username}`)} />
            <Button onClick={shout}>Shout</Button>
            <Button onClick={STEPS.length > 1 ? (c) => c.reply("many") : (c) => c.reply("one")}>Count</Button>
          </Row>
        ),
      }),
    );
    const res = await answer(app, chatInput("wrapped"));
    expect(res.component(res.allComponents[1]!.custom_id as string)?.style).toBe(1);
    expect((await answer(app, res.click("Go"))).text).toBe("forwarded to alice");
    expect((await answer(app, res.click("Shout"))).text).toBe("HEY ALICE");
    expect((await answer(app, res.click("Count"))).text).toBe("many");
  });

  test("strings with : and \\ round-trip", async () => {
    const echo = new App().command(command({ name: "echo", description: "Echo", handler: () => <Echo text={"a:b\\c"} /> }));
    const res = await answer(echo, chatInput("echo"));
    expect(res.allComponents.find((c) => c.type === 2)?.custom_id).toMatch(/:sa\\:b\\\\c$/);
    expect((await answer(echo, res.click("a:b\\c"))).allComponents.find((c) => c.type === 2)?.label).toBe("a:b\\c!");
  });

  test("a handler returning markup with handlers works through every click", async () => {
    const Confirm = ({ item }: { item: string }) => (
      <Row>
        <Button
          style="danger"
          onClick={() => (
            <Row>
              <Button onClick={(c) => c.reply(`deleted ${item}`)}>Yes, delete {item}</Button>
            </Row>
          )}
        >
          Delete
        </Button>
      </Row>
    );
    const confirm = new App().command(command({ name: "del", description: "Del", handler: () => <Confirm item="cookie" /> }));
    const asked = await answer(confirm, (await answer(confirm, chatInput("del"))).click("Delete"));
    expect((await answer(confirm, asked.click("Yes, delete cookie"))).text).toBe("deleted cookie");
  });

  test("async components load the rest from a small capture", async () => {
    const profiles = new App().command(command({ name: "p", description: "P", handler: () => <Profile id="42" /> }));
    const res = await answer(profiles, chatInput("p"));
    expect((await answer(profiles, res.click("Ada: 7"))).allComponents.find((c) => c.type === 2)).toMatchObject({ label: "Ada: 8" });
  });

  test("selects pass their values, typed by annotation", async () => {
    const Toppings = defineChoices({ nuts: "Nuts", salt: "Sea salt" });
    const Picker = () => (
      <Row>
        <StringSelect
          maxValues={2}
          options={Toppings}
          onSelect={(c, values: ("nuts" | "salt")[]) => {
            expectTypeOf(values).toEqualTypeOf<("nuts" | "salt")[]>();
            return c.reply(`picked ${values.join("+")}`);
          }}
        />
      </Row>
    );
    const picker = new App().command(command({ name: "pick", description: "Pick", handler: () => <Picker /> }));
    const res = await answer(picker, chatInput("pick"));
    const id = res.allComponents.find((c) => c.type === 3)!.custom_id as string;
    expect((await answer(picker, res.select(id, ["salt", "nuts"]))).text).toBe("picked salt+nuts");
  });

  test("outdated or tampered ids get the Fallback", async () => {
    const res = await answer(app, chatInput("counter"));
    const id = res.allComponents.find((c) => c.type === 2)!.custom_id as string;
    for (const bad of ["_nothere", `${id}:extra`, id.replace(/:n0:/, ":q0:"), id.split(":").slice(0, 2).join(":"), `${id}\\`]) {
      const out = await answer(app, click(bad));
      expect([bad, out.text, out.isEphemeral]).toEqual([bad, "This message is outdated.", true]);
    }
  });

  test("capturing an object fails at render, saying what to capture instead", async () => {
    const { logger, entries } = recordingLogger();
    const Bad = ({ user }: { user: { id: string } }) => (
      <Row>
        <Button onClick={() => JSON.stringify(user)}>x</Button>
      </Row>
    );
    await answer(new App({ logger }).command(command({ name: "bad", description: "B", handler: (c) => <Bad user={{ id: c.user.id }} /> })), chatInput("bad"));
    expect((entries[0]?.error as Error).message).toBe(
      "The handler in test/handlers.test.tsx: Bad captures `user`, which is an object; capture strings, numbers or booleans (like `user.id`), or load the rest from an id inside the handler",
    );
  });

  test("capturing a function fails at render, saying to define it at module scope", async () => {
    const { logger, entries } = recordingLogger();
    const Helper = ({ shout }: { shout: (s: string) => string }) => (
      <Row>
        <Button onClick={() => shout("hi")}>x</Button>
      </Row>
    );
    await answer(new App({ logger }).command(command({ name: "h", description: "H", handler: () => <Helper shout={(s) => s.toUpperCase()} /> })), chatInput("h"));
    expect((entries[0]?.error as Error).message).toMatch(/captures `shout`, which is a function; define it at module scope/);
  });

  test("captures past the 100-character custom_id limit fail at render with a hint", async () => {
    const { logger, entries } = recordingLogger();
    const Long = ({ text }: { text: string }) => (
      <Row>
        <Button onClick={() => text}>x</Button>
      </Row>
    );
    await answer(new App({ logger }).command(command({ name: "long", description: "L", handler: () => <Long text={"x".repeat(100)} /> })), chatInput("long"));
    const message = (entries[0]?.error as Error).message;
    expect(message).toMatch(/custom_id is \d+ characters; the limit is 100\. Carry an id and load the rest instead \(custom_id "[^":]+:…"\)$/);
    // Errors are logged: never the captured values (Custom ID State).
    expect(message).not.toContain("xxxx");
  });

  test("a local function an on* prop names is a handler, its captures read when it renders", async () => {
    const tally = new App().command(command({ name: "tally", description: "T", handler: (c) => <Tally n={1} owner={c.user.id} /> }));
    const res = await answer(tally, chatInput("tally"));
    const ids = res.allComponents.filter((c) => c.type === 2).map((c) => c.custom_id as string);
    // `shown` is read at render (10), after the declaration.
    expect(ids[0]).toMatch(/:i[0-9a-z]+:na$/);
    expect(tallyCalls).toBe(1);
    const added = await answer(tally, res.click("add"));
    expect([added.type, added.allComponents.find((c) => c.type === 2)?.custom_id]).toEqual([7, expect.stringMatching(/:n32$/)]);
    expect((await answer(tally, res.click("add").by({ id: "2" }))).text).toBe("Not yours");
    expect((await answer(tally, res.click("reset"))).allComponents.find((c) => c.type === 2)?.custom_id).toMatch(/:n0$/);
  });

  test("clicks run through the root App's middleware", async () => {
    const seen: number[] = [];
    const watched = new App().use((c, next) => (seen.push(c.interaction.type), next())).route(app);
    await answer(watched, (await answer(watched, chatInput("counter"))).click("+1"));
    expect(seen).toEqual([2, 3]);
  });
});

describe("modals", () => {
  const reports = new App()
    .command(command({ name: "report", description: "R", handler: () => <Report page="home" /> }))
    .command(command({ name: "post", description: "P", handler: () => <Reportable page="post-1" /> }))
    .command(command({ name: "inline", description: "I", handler: () => <Inline page="post-2" /> }));

  test("a command opens a modal; the submit gets values by input name", async () => {
    const opened = await answer(reports, chatInput("report"));
    expect(opened.type).toBe(9);
    expect(opened.component("what")).toMatchObject({ type: 4, custom_id: "what", style: 2 });
    const submitted = await answer(reports, opened.submit({ what: "It broke", severity: "high", notify: true, extra: "" }));
    expect([submitted.type, submitted.text]).toEqual([4, "home: It broke (high, notify: true, extra: -)"]);
  });

  test("a button opens a modal; markup from its submit updates the message the button was on", async () => {
    const opened = await answer(reports, (await answer(reports, chatInput("inline"))).click("Report"));
    expect(opened.type).toBe(9);
    const submitted = await answer(reports, opened.submit({ why: "spam" }));
    expect([submitted.type, submitted.text]).toEqual([7, "Thanks for reporting post-2 (spam)"]);
  });

  test("c.reply from a modal opened by a button answers with a new message", async () => {
    const opened = await answer(reports, (await answer(reports, chatInput("post"))).click("Report"));
    const submitted = await answer(reports, opened.submit({ what: "x", notify: false }));
    expect([submitted.type, submitted.text]).toEqual([4, "post-1: x (-, notify: false, extra: -)"]);
  });

  test("modal inputs need a name", async () => {
    const { logger, entries } = recordingLogger();
    const Nameless = () => (
      <Modal title="t" onSubmit={() => "x"}>
        <Label text="A">
          <TextInput {...({} as { name: string })} />
        </Label>
      </Modal>
    );
    await answer(new App({ logger }).command(command({ name: "n", description: "N", handler: () => <Nameless /> })), chatInput("n"));
    expect((entries[0]?.error as Error).message).toBe("<TextInput> in a <Modal> needs a name, its key in onSubmit's values");
  });
});

describe("named()", () => {
  test("gives a handler a stable id", async () => {
    const RoleMenu = ({ role }: { role: string }) => (
      <Row>
        <Button onClick={named("toggle-role", (c) => c.ephemeral(`toggled ${role}`))}>Toggle</Button>
      </Row>
    );
    const roles = new App().command(command({ name: "roles", description: "R", handler: () => <RoleMenu role="baker" /> }));
    const res = await answer(roles, chatInput("roles"));
    expect(res.allComponents.find((c) => c.type === 2)?.custom_id).toMatch(/^toggle-role~[0-9a-z]{5}:sbaker$/);
    expect((await answer(roles, click("toggle-role:sbaker"))).text).toBe("toggled baker");
  });

  test("two modules may not use the same id", () => {
    __handler("shared-id", [], () => () => "a", "src/a.tsx: A");
    __handler("shared-id", [], () => () => "a", "src/a.tsx: A");
    expect(() => __handler("shared-id", [], () => () => "b", "src/b.tsx: B")).toThrow('Handler id "shared-id" is used twice: in src/a.tsx: A and in src/b.tsx: B');
  });
});

describe("without @composurejs/vite", () => {
  test("a function on* prop fails at render, saying how to write it and that the plugin must be in the build", async () => {
    const { logger, entries } = recordingLogger();
    const raw = new App({ logger }).command(
      command({ name: "raw", description: "R", handler: () => jsx(Row, { children: jsx(RawButton, { onClick: () => "hi", children: "x" }) }) }),
    );
    await answer(raw, chatInput("raw"));
    expect((entries[0]?.error as Error).message).toContain("<Button onClick> got a function the build did not compile");
    expect((entries[0]?.error as Error).message).toContain("plugins: [composure()]");
  });

  test("named() throws when called", () => {
    expect(() => rawNamed("x", () => 1)).toThrow('named("x", ..): Inline Handlers are compiled by @composurejs/vite');
  });
});
