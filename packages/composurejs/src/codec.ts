// Custom ID State (ADR 0009, 0015): fields joined by `:`, `\` escaping `:` and `\`. Never JSON or
// base64. Captured values describe their own type with a one-letter tag, so no schema is needed.

/** Returned when text does not decode; the Interaction goes to the Fallback. */
export const FAIL: unique symbol = Symbol("composurejs.decodeFailed")
export type Fail = typeof FAIL

/** Joins fields with `:`, escaping `:` and `\`. */
export function joinFields(fields: readonly string[]): string {
  return fields.map((f) => f.replace(/[\\:]/g, (ch) => `\\${ch}`)).join(":")
}

/** Splits `joinFields` output; `undefined` if an escape is broken. */
export function splitFields(text: string): string[] | undefined {
  const out: string[] = []
  let current = ""
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === "\\") {
      const next = text[++i]
      if (next !== "\\" && next !== ":") return undefined
      current += next
    } else if (ch === ":") {
      out.push(current)
      current = ""
    } else current += ch
  }
  out.push(current)
  return out
}

/**
 * The Owning Route key of a top-level Command (ADR 0026): 5 base-36 characters of an FNV-1a hash of
 * its type and name, so it stays the same while the Command does.
 */
export function routeKey(type: number, name: string): string {
  let hash = 0x811c9dc5
  for (const ch of `${type}:${name}`) {
    hash ^= ch.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193)
  }
  return ((hash >>> 0) % 36 ** 5).toString(36).padStart(5, "0")
}

/** Splits the Owning Route off a handler's `custom_id`: `id~route:fields` → route and `id:fields`. */
export function splitRoute(customId: string): { route: string | undefined; customId: string } {
  const [id, rest] = prefixOf(customId)
  const tilde = id.indexOf("~")
  if (tilde === -1) return { route: undefined, customId }
  return { route: id.slice(tilde + 1), customId: id.slice(0, tilde) + (rest === undefined ? "" : `:${rest}`) }
}

/** Marks a handler's `custom_id` with an Owning Route, unless it already has one. */
export function withRoute(customId: string, route: string | undefined): string {
  if (route === undefined) return customId
  const [id, rest] = prefixOf(customId)
  if (id.includes("~")) return customId
  return `${id}~${route}${rest === undefined ? "" : `:${rest}`}`
}

/** The routing prefix of a `custom_id`: everything before the first `:`. */
export function prefixOf(customId: string): [prefix: string, rest: string | undefined] {
  const i = customId.indexOf(":")
  return i === -1 ? [customId, undefined] : [customId.slice(0, i), customId.slice(i + 1)]
}

const SNOWFLAKE = /^[1-9]\d{15,19}$/
const MAX_SNOWFLAKE = 2n ** 64n

/**
 * One captured value as a tagged field: `i` snowflake (base 36: 19 digits become 12),
 * `n` safe integer (base 36), `d` other finite number, `s` string, `T`/`F`, `u` undefined,
 * `z` null. Undefined for anything else (objects, functions, NaN), which cannot be carried.
 */
export function encodeValue(value: unknown): string | undefined {
  switch (typeof value) {
    case "string":
      if (SNOWFLAKE.test(value) && BigInt(value) < MAX_SNOWFLAKE) return `i${BigInt(value).toString(36)}`
      return `s${value}`
    case "number":
      if (Number.isSafeInteger(value)) return `n${value.toString(36)}`
      return Number.isFinite(value) ? `d${value}` : undefined
    case "boolean":
      return value ? "T" : "F"
    case "undefined":
      return "u"
  }
  return value === null ? "z" : undefined
}

export function decodeValue(text: string): unknown {
  const tag = text[0]
  const rest = text.slice(1)
  switch (tag) {
    case "s":
      return rest
    case "i":
      return /^[0-9a-z]+$/.test(rest) ? parseBase36BigInt(rest).toString() : FAIL
    case "n": {
      if (!/^-?[0-9a-z]+$/.test(rest)) return FAIL
      const n = parseInt(rest, 36)
      return Number.isSafeInteger(n) ? n : FAIL
    }
    case "d":
      return rest !== "" && Number.isFinite(Number(rest)) ? Number(rest) : FAIL
  }
  if (text === "T") return true
  if (text === "F") return false
  if (text === "u") return undefined
  if (text === "z") return null
  return FAIL
}

function parseBase36BigInt(digits: string): bigint {
  let n = 0n
  for (const d of digits) n = n * 36n + BigInt(parseInt(d, 36))
  return n
}
