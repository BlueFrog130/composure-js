# Getting started

composurejs builds Discord bots that receive only **HTTP Interactions**. There's no gateway connection, so a bot is a function from a request to a response that runs anywhere `fetch` does: Cloudflare Workers, Node, Bun.

## Create a bot

```sh
pnpm create composurejs my-bot
```

Pick Cloudflare Workers, Node or Bun. Each template has the same starting bot (`/ping`, `/greet`, a `/counter` with buttons) and tests.

## Connect it to Discord

1. In the [Developer Portal](https://discord.com/developers/applications), create an application **for development** (your Dev Application) and add its bot to a test server. Keep it separate from the one you deploy.
2. `pnpm create composurejs` asks for the Dev Application's id (General Information → Application ID) and the test server's id (Developer Mode → right-click the server → Copy Server ID), and writes them into `vite.config.ts`. If you skipped them, fill them in there:

```ts twoslash
import composure from "@composurejs/vite"
// ---cut---
composure({ dev: { application: "1100146565504565411", guild: "798662131062931547" } })
```

3. Copy `.env.example` to `.env.local` and fill in the Dev Application's secrets:

| Variable | Where it comes from |
|---|---|
| `DISCORD_PUBLIC_KEY` | General Information → Public Key |
| `DISCORD_TOKEN` | Bot → Token |

4. Run `pnpm dev`. It serves the bot, opens a public tunnel, sets the Dev Application's Interactions Endpoint URL to it, and syncs the Commands to your test server. Type `/counter` in Discord and press the button. See [Local development](./local-dev) for what each step does.

Production's secrets go in `.env.production.local`, which `pnpm dev` never reads ([Deploying](./deploying#sync)).

## The shape of a bot

An **App** lists the Commands a bot serves. That list is what answers Interactions and what [Sync](./deploying#sync) publishes to Discord.

```tsx twoslash
import { App, command, option } from "composurejs"

export const greet = command({
  name: "greet",
  description: "Greet someone",
  options: { user: option.user("Who to greet") },
  handler: (c, { user }) => `${c.user.username} waves at ${user.displayName}`,
  //                ^?
})

export const app = new App().command(greet)
```

The handler's second argument is typed from `options`. Hover `user` above: it is a `ResolvedUser`, already resolved from the Interaction. Answers are return values: a string, a JSX message, a modal, or a deferred reply ([Responses](./responses)).

Buttons answer the same way, written where the button is:

```tsx twoslash
import { Button, Container, Row, Text } from "composurejs"
// ---cut---
export const Counter = ({ count }: { count: number }) => (
  <Container>
    <Text>## Count: {count}</Text>
    <Row>
      <Button onClick={() => <Counter count={count + 1} />}>+1</Button>
    </Row>
  </Container>
)
```

The click updates the message with the markup it returns. There are no ids to choose and nothing to register; [Handlers and Views](./views) explains how.
