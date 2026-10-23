// The Worker: `fetch` answers Interactions and Webhook Events (the App, as is), `scheduled` is the
// cron trigger (wrangler.jsonc's `triggers`) announcing new releases.
import { BotClient } from "composurejs/rest"
import { app } from "./app.tsx"
import { type Bindings, loadData } from "./env.ts"
import { announceNew } from "./notify.tsx"

/** Announces new releases; logged, never thrown, so a failed run just waits for the next one. */
export async function announce(env: Bindings): Promise<void> {
  try {
    if (!env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN is not set")
    const versions = await announceNew(new BotClient(env.DISCORD_TOKEN), loadData(env))
    if (versions.length > 0) console.info({ msg: "announced", versions })
  } catch (error) {
    console.error({ msg: "announcing failed", error: String(error) })
  }
}

export default {
  fetch: app.fetch,
  scheduled(_controller: unknown, env: Bindings, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(announce(env))
  },
}
