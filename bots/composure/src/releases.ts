// The `composurejs` package's releases, from the GitHub Releases API: Changesets publishes each
// package's version as its own release, tagged `composurejs@0.2.0`, with that version's changelog
// as the body. Only `composurejs`'s are followed. The cron trigger refreshes the copy in the Store;
// handlers read only that copy, fetching once if it is missing.
import type { Data } from "./env.ts"
import { getJson } from "./http.ts"

/** Where the releases are kept, newest first. */
export const RELEASES_KEY = "releases"

/** The package whose releases these are; what the tag starts with, before the `@`. */
export const PACKAGE = "composurejs"

export interface Release {
  /** `0.1.2`, without the tag's `composurejs@`. */
  version: string
  /** `2026-10-20` */
  date: string
  /** The release's page on GitHub. */
  url: string
  /** The release notes, as markdown. */
  notes: string
}

/** What the GitHub API returns per release, as far as read. */
interface GitHubRelease {
  tag_name: string
  html_url: string
  body: string | null
  published_at: string | null
  draft: boolean
  prerelease: boolean
}

/** Published (not draft, not prerelease) `composurejs` releases from GitHub, newest first. */
export async function fetchReleases({ config, http }: Pick<Data, "config" | "http">): Promise<Release[]> {
  const headers: Record<string, string> = { "x-github-api-version": "2022-11-28" }
  if (config.githubToken) headers.authorization = `Bearer ${config.githubToken}`
  const releases = await getJson<GitHubRelease[]>(http, `https://api.github.com/repos/${config.repo}/releases?per_page=100`, headers)
  return (
    releases
      .filter((r) => !r.draft && !r.prerelease && r.tag_name.startsWith(`${PACKAGE}@`) && r.published_at)
      .map((r) => ({ version: r.tag_name.slice(PACKAGE.length + 1), date: r.published_at!.slice(0, 10), url: r.html_url, notes: r.body ?? "" }))
      // ISO dates sort as text; the API's order is by creation, not publication
      .sort((a, b) => b.date.localeCompare(a.date) || compareVersions(b.version, a.version))
  )
}

/** Orders `a` and `b` by their numeric `x.y.z` parts. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(".").map((p) => Number.parseInt(p, 10) || 0)
  const [pa, pb] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * Fetches the releases and keeps them in the Store, writing only when they changed (KV writes are
 * the scarce ones, and the cron trigger refreshes every 15 minutes).
 */
export async function refreshReleases(data: Data): Promise<Release[]> {
  const releases = await fetchReleases(data)
  const json = JSON.stringify(releases)
  if ((await data.store.get(RELEASES_KEY)) !== json) await data.store.put(RELEASES_KEY, json)
  return releases
}

/** The stored releases; fetched and stored when missing (before the cron trigger first ran). */
export async function loadReleases(data: Data): Promise<Release[]> {
  const stored = await data.store.get(RELEASES_KEY)
  if (stored !== null) {
    try {
      return JSON.parse(stored) as Release[]
    } catch {
      // Refetched below
    }
  }
  return refreshReleases(data)
}

/** The index of `version` (`0.1.2` or `v0.1.2`), or -1. */
export function position(releases: readonly Release[], version: string): number {
  const wanted = version.trim().replace(/^v/, "")
  return releases.findIndex((r) => r.version === wanted)
}

/**
 * The first `x.y.z` version in `text` that is not named for another package: `composurejs v0.1.2`
 * and a bare `v0.1.2` count, while `composure v0.1.2` (composure-rs's bot announces that one, in the
 * same server) and `@composurejs/vite@0.3.0` are skipped.
 */
export function findVersion(text: string): string | undefined {
  for (const match of text.matchAll(/(?<![\d.])\d+\.\d+\.\d+/g)) {
    if (!isOtherPackage(namedFor(text.slice(0, match.index)))) return match[0]
  }
  return undefined
}

/** The word a version follows: `composure` in `composure/v0.1.4`, `composurejs` in `**composurejs** v0.2.0`. */
function namedFor(before: string): string {
  const stripped = before.replace(/(?<![a-z])v$/i, "").replace(/[\s@/*`~:]+$/, "")
  return /[\w@/.-]*$/.exec(stripped)![0]
}

/** A Composure package other than this one. */
function isOtherPackage(word: string): boolean {
  return /composure/i.test(word) && word.toLowerCase() !== PACKAGE
}

/**
 * Release notes made for Discord: headings one level down (the page has its own `##`), `###` and
 * below bold, and hard-wrapped paragraphs joined (Discord keeps every newline).
 */
export function tidy(notes: string): string {
  const lines: string[] = []
  let fenced = false
  let joinable = false
  for (const line of notes.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith("```")) {
      fenced = !fenced
      lines.push(trimmed)
      joinable = false
      continue
    }
    if (fenced) {
      lines.push(line.trimEnd())
      continue
    }
    if (trimmed === "") {
      if (lines.length > 0 && lines.at(-1) !== "") lines.push("")
      joinable = false
      continue
    }
    const title = heading(trimmed)
    if (title !== undefined) {
      lines.push(title)
      joinable = false
      continue
    }
    const startsBlock = /^(?:[-*] |>|\||\d+\. )/.test(trimmed)
    if (joinable && !startsBlock) lines[lines.length - 1] += ` ${trimmed}`
    else lines.push(line.trimEnd())
    joinable = !trimmed.startsWith("|")
  }
  return lines.join("\n").trim()
}

function heading(line: string): string | undefined {
  const match = /^(#+) (.*)$/.exec(line)
  if (!match) return undefined
  const text = match[2]!.trim()
  return match[1]!.length <= 2 ? `### ${text}` : `**${text}**`
}

/** At most `max` characters of `text`, cut at a paragraph (or line) break, code fences closed; and whether anything was cut. */
export function excerpt(text: string, max: number): [string, boolean] {
  const chars = Array.from(text)
  if (chars.length <= max) return [text, false]
  const head = chars.slice(0, max).join("")
  let cut = head.lastIndexOf("\n\n")
  if (cut === -1) cut = head.lastIndexOf("\n")
  if (cut === -1) cut = head.length
  let out = head.slice(0, cut).trimEnd()
  if ((out.match(/```/g)?.length ?? 0) % 2 === 1) out += "\n```"
  return [out, true]
}
