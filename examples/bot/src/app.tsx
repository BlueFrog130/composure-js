// The example's App, shared by every platform entry (src/node.ts, src/worker.ts, src/bun.ts).
import {
  App,
  Button,
  command,
  Container,
  defineChoices,
  Ephemeral,
  group,
  md,
  middleware,
  option,
  Section,
  Separator,
  Text,
  userCommand,
  UserError,
} from "composurejs"

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
    topping: option.string("Topping").autocomplete((_c, input) => TOPPINGS.filter((t) => t.startsWith(input.toLowerCase()))).optional(),
  },
  contexts: ["guild", "botDm", "privateChannel"],
  integrationTypes: ["guildInstall", "userInstall"],
  handler: (_c, { user, flavor, count = 1, topping }) =>
    `${user.displayName} gets ${count} ${flavor} ${count === 1 ? "cookie" : "cookies"}${topping ? ` with ${topping}` : ""} 🍪`,
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

const basics = new App().command(ping).command(hello).command(cookie).command(highFive)

export const app = new App().route(basics).route(server)
