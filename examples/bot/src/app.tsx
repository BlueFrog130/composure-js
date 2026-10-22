// The example's App, shared by every platform entry (src/node.ts, src/worker.ts, src/bun.ts).
import {
  App,
  Button,
  Checkbox,
  command,
  Container,
  defineChoices,
  Ephemeral,
  group,
  Label,
  md,
  middleware,
  named,
  Modal,
  option,
  RadioGroup,
  Row,
  Section,
  Separator,
  Text,
  TextInput,
  userCommand,
  UserError,
} from "composurejs"
import { counter } from "./counter.tsx"

const BRAND = 0x5865f2

export const ping = command({
  name: "ping",
  description: "Check the bot is alive",
  handler: () => "Pong!",
})

export const hello = command({
  name: "hello",
  description: "Say hello with a View",
  handler: (c) => (
    <Container accentColor={BRAND}>
      <Section accessory={<Button url="https://github.com/BlueFrog130/composure-js">Source</Button>}>
        <Text>## Hello, {c.user.global_name ?? c.user.username}</Text>
        <Text>-# answered by composurejs</Text>
      </Section>
      <Separator />
      <Text>
        {md`
          - Views are JSX
          - Limits are checked before Discord sees them
        `}
      </Text>
    </Container>
  ),
})

const Flavor = defineChoices({ chocolate: "Chocolate chip", oat: "Oatmeal raisin", sugar: "Sugar" })
const TOPPINGS = ["sprinkles", "sea salt", "icing", "nuts"]

export const cookie = command({
  name: "cookie",
  description: "Give someone a cookie",
  options: {
    user: option.user("Who gets it"),
    flavor: option.string("Flavor").choices(Flavor),
    count: option.integer("How many", { min: 1, max: 12 }).optional(),
    topping: option
      .string("Topping")
      .autocomplete((_c, input) => TOPPINGS.filter((t) => t.startsWith(input.toLowerCase())))
      .optional(),
  },
  contexts: ["guild", "botDm", "privateChannel"],
  integrationTypes: ["guildInstall", "userInstall"],
  handler: (_c, { user, flavor, count = 1, topping }) => `${user.displayName} gets ${count} ${flavor} ${count === 1 ? "cookie" : "cookies"}${topping ? ` with ${topping}` : ""} 🍪`,
})

/** Answers with an ephemeral notice outside servers. */
const guildOnly = middleware((c, next) => (c.guildId ? next() : Ephemeral("Run this in a server.")))

export const server = new App().use(guildOnly).command(
  group({
    name: "server",
    description: "About this server",
    subcommands: [
      command({ name: "id", description: "This server's id", handler: (c) => c.ephemeral(`This is guild ${c.guildId}`) }),
      command({
        name: "member",
        description: "When a member joined",
        options: { who: option.user("Member") },
        handler: (_c, { who }) => {
          if (!who.member?.joined_at) throw new UserError(`${who.displayName} is not in this server.`)
          return `${who.displayName} joined <t:${Math.floor(Date.parse(who.member.joined_at) / 1000)}:R>`
        },
      }),
    ],
  }),
)

export const highFive = userCommand({ name: "High five", handler: (c, target) => `${c.user.username} high-fives ${target.displayName} 🙏` })

// A poll meant to last: named() keeps its buttons working across deploys that move the handlers.
export const poll = command({
  name: "poll",
  description: "Ask a yes/no question",
  options: { question: option.string("The question", { maxLength: 200 }) },
  handler: (_c, { question }) => (
    <Container accentColor={BRAND}>
      <Text>### {question}</Text>
      <Row>
        <Button style="success" emoji="👍" onClick={named("poll-yes", (c) => c.ephemeral(`${c.user.username} voted 👍`))}>
          Yes
        </Button>
        <Button style="danger" emoji="👎" onClick={named("poll-no", (c) => c.ephemeral(`${c.user.username} voted 👎`))}>
          No
        </Button>
      </Row>
    </Container>
  ),
})

const Mood = defineChoices({ great: "Great", fine: "Fine", meh: "Meh" })
type FeedbackValues = { mood: "great" | "fine" | "meh"; notes: string | undefined; followUp: boolean }

export const Feedback = () => (
  <Modal
    title="Feedback"
    onSubmit={(c, { mood, notes, followUp }: FeedbackValues) =>
      c.ephemeral(
        <Container>
          <Text>### Thanks for your feedback!</Text>
          <Text>Mood: {mood}</Text>
          {notes && (
            <>
              <Separator />
              <Text>Notes: {notes}</Text>
            </>
          )}
          {followUp && (
            <>
              <Separator />
              <Text>We'll be in touch!</Text>
            </>
          )}
        </Container>,
      )
    }
  >
    <Label text="How is it going?">
      <RadioGroup name="mood" options={Mood} />
    </Label>
    <Label text="Anything to add?">
      <TextInput name="notes" paragraph maxLength={1000} placeholder="Optional" required={false} />
    </Label>
    <Label text="Contact me about this">
      <Checkbox name="followUp" />
    </Label>
  </Modal>
)

export const feedback = command({ name: "feedback", description: "Tell us how it's going", handler: () => <Feedback /> })

const basics = new App().command(ping).command(hello).command(cookie).command(highFive)
const interactive = new App().command(poll).command(feedback).command(counter)

/** Deferred: answers at once with a loading state, then edits in the result (up to ~30s on Workers). */
export const report = command({
  name: "report",
  description: "Build a slow report",
  handler: (c) =>
    c.defer(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return (
        <Container accentColor={BRAND}>
          <Text>### Report for {c.user.username}</Text>
          <Text>-# generated in the background</Text>
        </Container>
      )
    }),
})

export const app = new App()
  .route(basics)
  .route(server)
  .route(interactive)
  .command(report)
  .events((_c, event) => {
    console.info({ msg: "Webhook Event", type: event.type })
  })
  .use(
    middleware((c, next) => {
      console.log(c.raw)
      return next()
    }),
  )
