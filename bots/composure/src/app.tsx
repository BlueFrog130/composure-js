// composurejs's own Discord bot: announces each release, pages through the changelog and searches
// the guide. Everything here is platform-agnostic, written against Bot Data (`c.data`); the Worker
// entry (src/index.ts) adds the cron trigger, and the tests run it with stand-ins.
//
// - changelog.tsx: `/changelog`, `/compare` and "Explain release", one paginated View
// - notify.tsx: `/notify setup|remove|status|preview`, release announcements (cron)
// - docs.tsx: `/docs`, guide and API search with autocomplete
// - packages.tsx: `/package`, npm stats from deferred work
// - feedback.tsx: `/feedback`, a modal posted to the maintainers
// - about.tsx: `/about`, `/invite`
// - events.tsx: install logging and the installer's welcome DM
// - ui.tsx: the tone containers every message is built from
import { about, invite } from "./about.tsx"
import { changelogs } from "./changelog.tsx"
import { docs } from "./docs.tsx"
import { createApp, loadData } from "./env.ts"
import { onEvent } from "./events.tsx"
import { feedback } from "./feedback.tsx"
import { notify } from "./notify.tsx"
import { pkg } from "./packages.tsx"
import { renderError } from "./ui.tsx"

/** Every Command the bot serves, synced by `pnpm sync`. */
export const app = createApp({ data: loadData })
  .route(changelogs)
  .command(notify)
  .command(docs)
  .command(pkg)
  .command(feedback)
  .command(about)
  .command(invite)
  .events(onEvent)
  .onError(renderError)
