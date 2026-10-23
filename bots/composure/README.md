# composurejs bot

composurejs's own Discord bot, built with composurejs and served from Cloudflare Workers. It
announces each release, pages through the changelog and searches the guide. It does what
[composure-rs's bot](https://github.com/BlueFrog130/composure-rs/tree/main/bots/composure) does,
for composurejs, and both live in the same home server. It's a real deployment rather than an
example; [examples/bot](../../examples/bot) teaches the framework.

| Command | What it does | Shows |
|---|---|---|
| `/changelog [version]` | One release per page: newer/older buttons, a jump menu, a link to GitHub | A View with async Inline Handlers, Captures, re-render vs. ephemeral copy |
| `/compare <from> [to]` | The same pages, limited to a range | Two autocompleted Options, one View for both Commands |
| *Explain release* (message) | Opens the changelog at the version a message mentions | Message context menus, reading Components V2 text |
| `/notify setup\|remove\|status\|preview` | Release announcements in a server's channel | A Group, channel `types`, `defaultMemberPermissions`, guild-only, REST errors as User Errors, `route()` for an unwrapped Endpoint |
| `/docs <topic>` | Guide sections and API items, suggested while typing | Autocomplete over `docs/guide`, inlined at build by `import.meta.glob` |
| `/package [name]` | Version and downloads from npm | `c.defer`, Choices, KV cache with a TTL |
| `/feedback` | A form posted to the maintainers, plus a prefilled GitHub issue link | A modal with typed submit values |
| `/about`, `/invite` | What this is; install links for servers and for users | Components V2, link buttons |

It also logs every install to a private channel and DMs whoever adds it to a server (the
`APPLICATION_AUTHORIZED` Webhook Event).

## Next to composure-rs's bot

Both bots run in the home server and offer the same Commands. Where their names could collide:

| What | composure-rs | composurejs | Why it works |
|---|---|---|---|
| Discord application | its own | its own | Commands, components and webhooks are per application, so neither ever receives the other's Interactions. Name them **composure-rs** and **composurejs** in the Developer Portal: Discord labels every Command and context menu entry with the app's name, and names the bot's managed role after it. |
| Slash Commands | `/changelog`, `/compare`, `/notify`, `/docs`, `/feedback`, `/about`, `/invite`, `/crate` | the same, with `/package` for `/crate` | Same names on purpose: the picker shows both, each under its app, and a server with only one bot sees plain names. Prefixes (`/js-changelog`) were rejected: every server would pay for a clash that only the home server has. |
| *Explain release* | its own | its own | Both appear under Apps, labeled by bot. Each skips versions named for another package (`composure v0.1.2` vs. `composurejs v0.1.2`), so neither opens the other's changelog at a version that happens to exist in both. |
| Announcement channel | `#rust-releases` | `#js-releases` | One per bot, since following is per channel. Distinct names keep the follower webhooks Discord creates (`Composure #rust-releases`) apart in a server's Integrations. `/notify` only lists and removes followers whose source is its own channel, so neither bot touches the other's. |
| Feedback and install-log channels | may be shared | may be shared | Each post's author is the bot that sent it. Separate channels work as well: they are vars. |
| Accent color | rust orange `0xd34516` | TypeScript blue `0x3178c6` | Tells the two announcements apart at a glance. |
| Footer | `-# composure-rs · Rust` | `-# composurejs · TypeScript` | Under every panel: names the bot where the accent color does not show (notification previews, colorblind readers). |
| Worker | `composure-bot` | `composurejs-bot` | Both in one Cloudflare account. |
| KV namespace | its own | `composurejs-bot` | Keys (`releases`, `announced`) are the same, so they must never share one. |
| CI secrets | composure-rs's repository | this repository | Each `DISCORD_TOKEN` is its own application's. |

The rest needs nothing: custom ids, cron schedules and Webhook Events URLs are per application or
per Worker. In a dev server shared by both dev applications, `vite dev` syncs only its own
application's Commands.

## How announcements work

- Every 15 minutes, `scheduled` in [`src/index.ts`](src/index.ts) fetches the repository's GitHub
  Releases and stores them in KV, where every Command reads them. Changesets publishes each
  package's version as its own release; only `composurejs@x.y.z` ones are followed, and drafts and
  prereleases are skipped.
- Each release newer than the last one announced is posted to the home server's announcement
  channel (`ANNOUNCE_CHANNEL_ID`) and published, oldest first. The first run announces every
  release, so the channel starts with the full history.
- `/notify setup #channel` makes the server follow that channel, so Discord delivers the published
  posts. Nothing is stored per server: `/notify status` and `remove` read the server's channel
  follower webhooks. Adding the bot to a server asks only for **Manage Webhooks**.

## Code

[`src/app.tsx`](src/app.tsx) lists the App. Handlers reach the outside world only through Bot
Data ([`src/env.ts`](src/env.ts)): the config from vars, Workers KV as the Store, and a Transport
for GitHub and npm. [`test/world.ts`](test/world.ts) stands in for all three: a map for KV and one
Transport that answers Discord, GitHub and npm by URL. [`test/build.test.ts`](test/build.test.ts)
builds the real Worker and runs it on workerd.

Every message is built from the tone containers in [`src/ui.tsx`](src/ui.tsx): `<ui.Primary>`,
`<ui.Secondary>`, `<ui.Success>`, `<ui.Warning>` and `<ui.Error>`, each with an optional
`title`, so replies and messages sent through REST look the same. Handler errors are answered in
the same style by `renderError`, the App's Error Renderer.

## Set up

There are two environments in [`wrangler.jsonc`](wrangler.jsonc), each with its own Discord
application and home-server channels: the top level is dev (`vite dev` only), and `production` is
deployed as the Worker `composurejs-bot` (`vite build` selects it through `.env.production`).

For production you need a Discord application with a bot (not composure-rs's), and in the home
server an announcement channel of its own plus the feedback and log channels. Then:

1. `npx wrangler kv namespace create composurejs-bot`, and put the id under
   `env.production.kv_namespaces`.
2. Fill in `env.production.vars`: the application id, and the announcement, feedback and log
   channel ids.
3. Add the bot to the home server with **Send Messages** in those channels.
4. Set the secrets:

   ```sh
   npx wrangler secret put DISCORD_PUBLIC_KEY --env production
   npx wrangler secret put DISCORD_TOKEN --env production
   npx wrangler secret put GITHUB_TOKEN --env production   # fine-grained, read-only Contents
   ```

5. Deploy and sync (after `pnpm build` at the root):

   ```sh
   pnpm run deploy                               # vite build && wrangler deploy
   DISCORD_TOKEN=... pnpm sync                   # the production application's token
   ```

6. In the Developer Portal:
   - Set the **Interactions Endpoint URL** to the Worker's URL
     (`https://composurejs-bot.<subdomain>.workers.dev/interactions`).
   - Set the **Webhook Events URL** to the same host plus `/events`, and enable **Application
     Authorized**.
   - Under Installation, enable both **Guild Install** and **User Install**.

The [deploy workflow](../../.github/workflows/bot.yml) repeats step 5 on every push to main that
touches the bot, the packages or the guide, and after each release. It needs the repository
secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DISCORD_TOKEN` and
`DISCORD_APPLICATION_ID`, in a `bot` environment.

## Run locally

Fill in the top-level `vars` with the dev application's id and channels, copy
[`.env.example`](.env.example) to `.dev.vars` with the dev application's secrets, then
`pnpm dev`: the Dev Loop opens a tunnel, points the dev application at it and syncs to
`COMPOSURE_DEV_GUILD`. The cron runs on `GET /cdn-cgi/handler/scheduled`.

## Test

```sh
pnpm vitest run --project bot   # after pnpm build at the root, for test/build.test.ts
```

The tests cover every Command, the page turns, `/notify`'s webhook calls (and that composure-rs's
followers are left alone), the cron's announcements, the install events, Sync's definitions, and
the built Worker on workerd.
