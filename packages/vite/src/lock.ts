// The Handler Lock (ADR 0029): the committed list of every Handler Id a bot ships, with what each
// captures. A deploy that drops an id, or changes what one captures, turns buttons already sent into
// the Fallback; the lock makes that visible in review and stops it in CI.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import type { ShippedHandler } from "./transform.ts"

export const LOCK_FILE = "composure.handlers.json"

export interface LockedHandler {
  /** `file: owner`, as in errors. */
  where: string
  /** The captured paths, in custom_id order. */
  captures: string[]
}

/** Handler Id → where it is and what it captures. */
export type HandlerLock = Record<string, LockedHandler>

export interface LockDiff {
  /** Ids the lock lists that the code no longer ships. */
  removed: string[]
  /** Ids whose captures changed, so their old custom_ids no longer decode. */
  changed: string[]
  /** Ids the code ships that the lock does not list yet. */
  added: string[]
}

export function lockOf(handlers: Iterable<ShippedHandler>): HandlerLock {
  const out: HandlerLock = {}
  for (const { id, where, captures } of handlers) out[id] = { where, captures: [...captures] }
  return out
}

export function readLock(file: string): HandlerLock | undefined {
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, "utf8")) as HandlerLock
  } catch (error) {
    throw new Error(`${LOCK_FILE} is not valid JSON: ${(error as Error).message}`, { cause: error })
  }
}

/** Sorted by id, so diffs of the file are stable. */
export function formatLock(lock: HandlerLock): string {
  const sorted = Object.fromEntries(
    Object.keys(lock)
      .sort()
      .map((id) => [id, lock[id]!]),
  )
  return `${JSON.stringify(sorted, null, 2)}\n`
}

/** Writes the lock when its content changed, however a formatter has laid the file out; true if it did. */
export function writeLock(file: string, lock: HandlerLock): boolean {
  const text = formatLock(lock)
  const existing = readLock(file)
  if (existing && formatLock(existing) === text) return false
  writeFileSync(file, text)
  return true
}

export function diffLock(locked: HandlerLock, current: HandlerLock): LockDiff {
  const removed: string[] = []
  const changed: string[] = []
  for (const [id, entry] of Object.entries(locked)) {
    const now = current[id]
    if (!now) removed.push(id)
    else if (now.captures.join(",") !== entry.captures.join(",")) changed.push(id)
  }
  const added = Object.keys(current).filter((id) => !(id in locked))
  return { removed: removed.sort(), changed: changed.sort(), added: added.sort() }
}

/** What breaks, one line per handler: `- _Kq3vX9a (src/counter.tsx: Counter)`. */
export function describeBreaks(diff: LockDiff, locked: HandlerLock, current: HandlerLock): string {
  const lines = [
    ...diff.removed.map((id) => `  - ${id} (${locked[id]!.where}): no longer in the code`),
    ...diff.changed.map((id) => `  - ${id} (${current[id]!.where}): captures [${current[id]!.captures.join(", ")}], was [${locked[id]!.captures.join(", ")}]`),
  ]
  return lines.join("\n")
}

/** Whether this is a CI run, where the lock is checked and never written. */
export const inCi = (env: Record<string, string | undefined> = process.env) => !!env.CI && env.CI !== "false" && env.CI !== "0"
