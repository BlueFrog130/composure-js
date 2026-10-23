// The changelog, one release per page: `/changelog [version]`, `/compare <from> [to]` (the same
// pages, limited to a range) and the "Explain release" message Command.
//
// What a page's buttons need (who opened it, the range, the neighbours) travels in their
// `custom_id`s; the page itself is re-read from the stored releases on every click. Only the user
// who opened a page turns it; anyone else clicking gets their own ephemeral copy.
import { App, type AutocompleteContext, Button, type ComponentContext, Option, option, Row, Separator, StringSelect, Text, UserError } from "composurejs"
import { type BotEnv, command, EVERYWHERE, messageCommand } from "./env.ts"
import { excerpt, findVersion, loadReleases, position, type Release, tidy } from "./releases.ts"
import * as ui from "./ui.tsx"

/** Room for the notes: Discord allows 4000 characters of text per message, the rest is headings. */
const NOTES_LIMIT = 3400
/** Discord's limit on select options. */
const MAX_OPTIONS = 25

/** What a page shows, read from the releases; not carried in `custom_id`s. */
interface Page {
  release: Release
  /** 1-based, within the range. */
  number: number
  total: number
  /** Versions offered by the jump menu, around this one. */
  versions: string[]
  /** `/compare`'s summary line. */
  heading: string | undefined
}

export interface ChangelogProps {
  owner: string
  from: string | undefined
  to: string | undefined
  newer: string | undefined
  older: string | undefined
  page: Page
}

/** One release with buttons to the newer and older ones, a jump menu and a link to the release. */
export const Changelog = ({ owner, from, to, newer, older, page }: ChangelogProps) => {
  const [notes, cut] = excerpt(tidy(page.release.notes), NOTES_LIMIT)
  const more = cut ? `\n\n-# … [Read the rest on GitHub](${page.release.url})` : ""
  return (
    <ui.Primary>
      {page.heading !== undefined && <Text>-# {page.heading}</Text>}
      <Text>## composurejs v{page.release.version}</Text>
      <Text>
        -# Released {page.release.date} · {page.number} of {page.total}
      </Text>
      <Separator />
      <Text>{(notes || "_No release notes._") + more}</Text>
      <Separator />
      <Row>
        <Button disabled={newer === undefined} onClick={(c) => turn(c, owner, from, to, newer)}>
          ◀ Newer
        </Button>
        <Button disabled={older === undefined} onClick={(c) => turn(c, owner, from, to, older)}>
          Older ▶
        </Button>
        <Button url={page.release.url}>On GitHub</Button>
      </Row>
      <Row>
        <StringSelect placeholder="Jump to a release" onSelect={(c, values) => turn(c, owner, from, to, values[0])}>
          {page.versions.map((version) => (
            <Option value={version} label={`v${version}`} default={version === page.release.version} />
          ))}
        </StringSelect>
      </Row>
    </ui.Primary>
  )
}

/** Opens `version` for whoever clicked: in place for the page's owner, else as their own ephemeral copy. */
async function turn(c: ComponentContext<BotEnv>, owner: string, from: string | undefined, to: string | undefined, version: string | undefined) {
  if (version === undefined) throw new UserError("No more releases that way.")
  const page = <Changelog {...build(await loadReleases(c.data), c.user.id, version, from, to)} />
  return c.user.id === owner ? page : c.ephemeral(page)
}

/** The page for `version` (default: the newest in range) within `from`..`to` (default: every release), owned by `owner`. */
export function build(releases: readonly Release[], owner: string, version?: string, from?: string, to?: string): ChangelogProps {
  if (releases.length === 0) throw new UserError("There are no releases yet.")
  const find = (wanted: string) => {
    const index = position(releases, wanted)
    if (index === -1) throw new UserError(`There is no release \`${wanted}\`; pick one from the suggestions.`)
    return index
  }
  // Newest first, so the newer end has the lower index
  let [first, last] = [0, releases.length - 1]
  if (from !== undefined && to !== undefined) {
    const [a, b] = [find(from), find(to)]
    ;[first, last] = [Math.min(a, b), Math.max(a, b)]
  }
  const index = version === undefined ? first : find(version)
  if (index < first || index > last) throw new UserError("That release is outside this comparison.")
  const windowStart = Math.min(Math.max(index - Math.floor(MAX_OPTIONS / 2), first), Math.max(last + 1 - MAX_OPTIONS, first))
  const ranged = from !== undefined && to !== undefined
  return {
    owner,
    // The canonical versions (no `v`), so the custom_ids stay short
    from: ranged ? releases[last]!.version : undefined,
    to: ranged ? releases[first]!.version : undefined,
    newer: index > first ? releases[index - 1]!.version : undefined,
    older: index < last ? releases[index + 1]!.version : undefined,
    page: {
      release: releases[index]!,
      number: index - first + 1,
      total: last - first + 1,
      versions: releases
        .slice(windowStart, last + 1)
        .slice(0, MAX_OPTIONS)
        .map((r) => r.version),
      heading: ranged ? `Changes from v${releases[last]!.version} to v${releases[first]!.version}: ${last - first + 1} releases` : undefined,
    },
  }
}

/** Suggests released versions matching what was typed, newest first. */
async function versions(c: AutocompleteContext<BotEnv>, input: string) {
  const typed = input.trim().replace(/^v/, "")
  return (await loadReleases(c.data))
    .filter((r) => r.version.startsWith(typed))
    .slice(0, MAX_OPTIONS)
    .map((r) => ({ name: `v${r.version} (${r.date})`, value: r.version }))
}

export const changelog = command({
  name: "changelog",
  description: "Read composurejs's changelog, one release per page",
  ...EVERYWHERE,
  options: { version: option.string("Release to open (default: the latest)").autocomplete(versions).optional() },
  handler: async (c, { version }) => <Changelog {...build(await loadReleases(c.data), c.user.id, version)} />,
})

export const compare = command({
  name: "compare",
  description: "See what changed between two releases",
  ...EVERYWHERE,
  options: {
    from: option.string("The older release").autocomplete(versions),
    to: option.string("The newer release (default: the latest)").autocomplete(versions).optional(),
  },
  handler: async (c, { from, to }) => {
    const releases = await loadReleases(c.data)
    return <Changelog {...build(releases, c.user.id, undefined, from, to ?? releases[0]?.version ?? from)} />
  },
})

/** Every text a message shows: content, embeds, and Components V2 Text Displays (announcements are those). */
function textsOf(message: { content: string; embeds: { title?: string; description?: string }[]; components?: unknown[] }): string[] {
  const texts = [message.content]
  for (const embed of message.embeds) texts.push(embed.title ?? "", embed.description ?? "")
  const visit = (component: unknown) => {
    const c = component as { type?: number; content?: string; components?: unknown[]; accessory?: unknown }
    if (c.type === 10 && typeof c.content === "string") texts.push(c.content)
    c.components?.forEach(visit)
    if (c.accessory) visit(c.accessory)
  }
  ;(message.components ?? []).forEach(visit)
  return texts
}

export const explainRelease = messageCommand({
  name: "Explain release",
  ...EVERYWHERE,
  handler: async (c, message) => {
    const version = textsOf(message)
      .map(findVersion)
      .find((v) => v !== undefined)
    if (version === undefined) throw new UserError("That message doesn't mention a composurejs version like `0.1.2`.")
    return c.ephemeral(<Changelog {...build(await loadReleases(c.data), c.user.id, version)} />)
  },
})

/** The changelog Commands, routed from the root App. */
export const changelogs = new App<BotEnv>().command(changelog).command(compare).command(explainRelease)
