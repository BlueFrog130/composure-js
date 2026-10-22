// Custom ID State (ADR 0009): fields joined by `:`, `\` escaping `:` and `\`. Never JSON or base64.
import { AppConfigError } from "./errors.ts"
import type { Choices } from "./options.ts"

/** Returned by `decode` when the text does not match; the Interaction goes to the Fallback. */
export const FAIL: unique symbol = Symbol("composurejs.decodeFailed")
export type Fail = typeof FAIL

/** How one value is written to and read from a `custom_id`. `O` marks it optional. */
export class Codec<T, O extends boolean = false> {
  declare readonly __value: T
  declare readonly __optional: O

  constructor(
    readonly encode: (value: T) => string,
    readonly decode: (text: string) => T | Fail,
    readonly isOptional: boolean = false,
  ) {}

  /** May be `undefined`, written as nothing. An optional string decodes `""` as `undefined`. */
  optional(): Codec<T | undefined, true> {
    return new Codec<T | undefined, true>(
      (v) => (v === undefined ? "" : this.encode(v)),
      (s) => (s === "" ? undefined : this.decode(s)),
      true,
    )
  }
}

export type AnyCodec = Codec<any, boolean>
export type Codecs = Record<string, AnyCodec>

type Simplify<T> = { [K in keyof T]: T[K] } & {}

/** The value a record of Codecs describes; optional ones become `?:`. */
export type CodecValues<C extends Codecs> = Simplify<
  { [K in keyof C as C[K] extends Codec<any, true> ? never : K]: C[K]["__value"] } & {
    [K in keyof C as C[K] extends Codec<any, true> ? K : never]?: C[K]["__value"]
  }
>

const INT = /^-?\d+$/

/** Codec builders for Props and Component Handler state. */
export const p = {
  string: () => new Codec<string>((v) => v, (s) => s),
  /** A safe integer, in decimal. */
  int: () =>
    new Codec<number>(
      (v) => String(Math.trunc(v)),
      (s) => (INT.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : FAIL),
    ),
  number: () =>
    new Codec<number>(
      (v) => String(v),
      (s) => (s !== "" && Number.isFinite(Number(s)) ? Number(s) : FAIL),
    ),
  /** `1` or `0`. */
  bool: () => new Codec<boolean>((v) => (v ? "1" : "0"), (s) => (s === "1" ? true : s === "0" ? false : FAIL)),
  /** A Discord id. */
  snowflake: () => new Codec<string>((v) => v, (s) => (/^\d{1,20}$/.test(s) ? s : FAIL)),
  /** One of a Choices list's values, written as the value. */
  enum: <const V extends string>(choices: Choices<V>) => {
    const values = new Set<string>(choices.map((c) => c.value))
    return new Codec<V>((v) => v, (s) => (values.has(s) ? (s as V) : FAIL))
  },
}

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

export function encodeState<C extends Codecs>(codecs: C, value: CodecValues<C>): string[] {
  return Object.entries(codecs).map(([key, codec]) => codec.encode((value as Record<string, unknown>)[key]))
}

export function decodeState<C extends Codecs>(codecs: C, fields: readonly string[]): CodecValues<C> | Fail {
  const entries = Object.entries(codecs)
  if (fields.length !== entries.length) return FAIL
  const out: Record<string, unknown> = {}
  for (let i = 0; i < entries.length; i++) {
    const [key, codec] = entries[i]!
    const value = codec.decode(fields[i]!)
    if (value === FAIL) return FAIL
    if (value !== undefined) out[key] = value
  }
  return out as CodecValues<C>
}

/** Values captured by Inline Handlers that are not Props: tagged so they decode to the same type. */
export function encodePrimitive(value: unknown): string | undefined {
  if (typeof value === "string") return `s${value}`
  if (typeof value === "number" && Number.isFinite(value)) return `n${value}`
  if (typeof value === "boolean") return value ? "b1" : "b0"
  if (value === undefined) return "u"
  if (value === null) return "z"
  return undefined
}

export function decodePrimitive(text: string): unknown {
  const tag = text[0]
  const rest = text.slice(1)
  if (tag === "s") return rest
  if (tag === "n" && rest !== "" && Number.isFinite(Number(rest))) return Number(rest)
  if (text === "b1") return true
  if (text === "b0") return false
  if (text === "u") return undefined
  if (text === "z") return null
  return FAIL
}

const PREFIX = /^[A-Za-z0-9_-]{1,32}$/

export function checkPrefix(what: string, prefix: string): void {
  if (!PREFIX.test(prefix)) throw new AppConfigError(`${what} prefix "${prefix}" must be 1-32 letters, digits, "_" or "-"`)
}

/** The routing prefix of a `custom_id`: everything before the first `:`. */
export function prefixOf(customId: string): [prefix: string, rest: string | undefined] {
  const i = customId.indexOf(":")
  return i === -1 ? [customId, undefined] : [customId.slice(0, i), customId.slice(i + 1)]
}
