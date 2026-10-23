// Forms (ADR 0028): typed modal inputs, rendered from their definition and parsed on submit.
// Compiled by @composurejs/vite, as in a bot's build.
import { describe, expect, expectTypeOf, test } from "vitest";
import { App, command, defineChoices, field, form, Label, type LogEntry, type Logger, Modal, type ResolvedUser, Row, StringSelect, Text, TextInput } from "composurejs";
import { answer, chatInput, modalSubmit } from "composurejs/testing";

function recordingLogger() {
  const entries: (LogEntry & { level: string })[] = [];
  const at = (level: string) => (entry: LogEntry) => void entries.push({ level, ...entry });
  const logger: Logger = { debug() {}, info() {}, warn: at("warn"), error: at("error") };
  return { logger, entries };
}

const Mood = defineChoices({ great: "Great", fine: "Fine", meh: "Meh" });
const Topics = defineChoices({ bugs: "Bugs", ideas: "Ideas" });

const feedback = form({
  mood: field.radio(Mood, { label: "How is it going?" }),
  notes: field.text({ label: "Anything to add?", paragraph: true, maxLength: 500 }).optional(),
  stars: field.integer({ label: "Stars", min: 1, max: 5 }),
  topics: field.checkboxes(Topics, { label: "About" }).optional(),
  followUp: field.checkbox({ label: "Contact me" }),
});

const Feedback = ({ notes }: { notes?: string }) => (
  <Modal
    title="Feedback"
    form={feedback}
    values={{ notes, stars: 5 }}
    onSubmit={(c, v) => {
      expectTypeOf(v).toEqualTypeOf<{ mood: "great" | "fine" | "meh"; notes: string | undefined; stars: number; topics: ("bugs" | "ideas")[]; followUp: boolean }>();
      return c.ephemeral(`${v.mood} ${v.stars}★ ${v.notes ?? "-"} [${v.topics.join(",")}] ${v.followUp}`);
    }}
  />
);

const pick = form({ who: field.user({ label: "Who", max: 2 }) });
const Pick = () => (
  <Modal title="Pick" form={pick} onSubmit={(c, v) => (expectTypeOf(v.who).toEqualTypeOf<ResolvedUser[]>(), v.who.map((u) => u.displayName).join(" & "))}>
    <Text>Choose up to two.</Text>
  </Modal>
);

const app = new App()
  .command(command({ name: "feedback", description: "F", handler: () => <Feedback notes="so far so good" /> }))
  .command(command({ name: "pick", description: "P", handler: () => <Pick /> }));

describe("forms", () => {
  test("render one Label per Field, prefilled", async () => {
    const res = await answer(app, chatInput("feedback"));
    expect(res.type).toBe(9);
    const components = res.data!.components as { type: number; label?: string; component?: Record<string, unknown> }[];
    expect(components.map((c) => c.label ?? c.type)).toEqual(["How is it going?", "Anything to add?", "Stars", "About", "Contact me"]);
    expect(components[1]!.component).toMatchObject({ type: 4, custom_id: "notes", style: 2, required: false, max_length: 500, value: "so far so good" });
    expect(components[2]!.component).toMatchObject({ type: 4, custom_id: "stars~n:1:5:Stars", value: "5" });
    expect(components[0]!.component).toMatchObject({
      type: 21,
      custom_id: "mood",
      options: [
        { label: "Great", value: "great" },
        { label: "Fine", value: "fine" },
        { label: "Meh", value: "meh" },
      ],
    });
  });

  test("submitted values are typed and parsed", async () => {
    const opened = await answer(app, chatInput("feedback"));
    const res = await answer(app, opened.submit({ mood: "fine", notes: "", stars: "4", topics: ["bugs", "ideas"], followUp: true }));
    expect([res.text, res.isEphemeral]).toEqual(["fine 4★ - [bugs,ideas] true", true]);
  });

  test("a number out of range or not a number answers with a User Error naming the Field", async () => {
    const opened = await answer(app, chatInput("feedback"));
    const bad = await answer(app, opened.submit({ mood: "meh", stars: "9", topics: [], followUp: false }));
    expect([bad.text, bad.isEphemeral]).toEqual(['"Stars" must be at most 5.', true]);
    const nan = await answer(app, opened.submit({ mood: "meh", stars: "lots", topics: [], followUp: false }));
    expect(nan.text).toBe('"Stars" must be a whole number.');
  });

  test("user Fields resolve the chosen users", async () => {
    const opened = await answer(app, chatInput("pick"));
    const id = (opened.data!.components as { component: { custom_id: string } }[])[1]!.component.custom_id;
    expect(id).toBe("who~r");
    const res = await answer(
      app,
      modalSubmit(opened.data!.custom_id as string).users(id, [
        { id: "2", username: "bob", global_name: "Bob" },
        { id: "3", username: "cy" },
      ]),
    );
    expect(res.text).toBe("Bob & cy");
  });

  test("a Label written next to a form is an error; so is ~ in a hand-written input name", async () => {
    const { logger, entries } = recordingLogger();
    const broken = new App({ logger })
      .command(
        command({
          name: "mixed",
          description: "M",
          handler: () => (
            <Modal title="M" form={pick} onSubmit={() => "x"}>
              <Label text="Extra">
                <TextInput name="extra" />
              </Label>
            </Modal>
          ),
        }),
      )
      .command(
        command({
          name: "tilde",
          description: "T",
          handler: () => (
            <Modal title="T" onSubmit={() => "x"}>
              <Label text="Odd">
                <TextInput name="a~b" />
              </Label>
            </Modal>
          ),
        }),
      );
    await answer(broken, chatInput("mixed"));
    await answer(broken, chatInput("tilde"));
    expect(entries.map((e) => (e.error as Error).message)).toEqual([
      "<Label> cannot go next to <Modal form={..}>: add it to the Form as a Field",
      '<TextInput> name "a~b" cannot contain "~"',
    ]);
  });

  test("form keys and checkbox optionality are checked when defined", () => {
    expect(() => form({ "bad key": field.checkbox({ label: "x" }) })).toThrow('Form field "bad key": keys are 1-40 letters');
    expect(() => field.checkbox({ label: "x" }).optional()).toThrow("never required");
  });
});

describe("selects", () => {
  test("values are typed from options", () => {
    void (
      <Row>
        <StringSelect options={Topics} onSelect={(c, values) => (expectTypeOf(values).toEqualTypeOf<("bugs" | "ideas")[]>(), c.reply(values.join()))} />
      </Row>
    );
  });
});
