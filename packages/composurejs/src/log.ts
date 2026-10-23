// Structured logging (ADR 0030). Every entry is one object with a `msg`. Core binds the
// Interaction's fields to everything it logs while answering one (REST calls and Background Work
// included), and hands handlers the same logger as `c.log`.

/**
 * Structured logger. Each call gets one object; pino's loggers fit as they are.
 * Never pass the Interaction token, a URL holding it, or Custom ID State.
 */
export interface Logger {
  debug(entry: LogEntry): void
  info(entry: LogEntry): void
  warn(entry: LogEntry): void
  error(entry: LogEntry): void
  /** A logger adding `fields` to every entry. Optional: core wraps loggers that have none. */
  child?(fields: LogFields): Logger
}

export interface LogEntry {
  msg: string
  [field: string]: unknown
}

export type LogFields = Record<string, unknown>

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent"

/**
 * `object`: one object per console call, which Workers Logs indexes by field. `json`: one JSON
 * line, for log pipelines on Node and Bun. `pretty`: `LEVEL msg key=value`, then error stacks.
 */
export type LogFormat = "object" | "json" | "pretty"

export interface LoggerOptions {
  /** The least severe level written. Default `info`; `debug` adds REST responses, retries and Fallbacks. */
  level?: LogLevel | undefined
  /** Default: `object` on Workers, `pretty` elsewhere. */
  format?: LogFormat | undefined
  /** Fields on every entry. */
  fields?: LogFields | undefined
}

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 }
type Level = Exclude<LogLevel, "silent">

const noop = () => {}

/**
 * The console logger: levels filtered, entries written in `format`, Error values serialized with
 * their `cause` chain. The App's default is `createLogger()`.
 */
export function createLogger({ level = "info", format = defaultFormat(), fields }: LoggerOptions = {}): Logger {
  const min = LEVELS[level] ?? LEVELS.info
  const make = (bound: LogFields | undefined): Logger => {
    const at = (l: Level) => (LEVELS[l] < min ? noop : (entry: LogEntry) => write(l, format, bound ? { ...bound, ...entry } : entry))
    return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error"), child: (more) => make({ ...bound, ...more }) }
  }
  return make(fields)
}

let fallback: Logger | undefined
/** @internal The logger used where none is given: `createLogger()`, made on first use. */
export const defaultLogger = (): Logger => (fallback ??= createLogger())

/** `logger` with `fields` on every entry: its own `child` when it has one. */
export function withFields(logger: Logger, fields: LogFields): Logger {
  if (logger.child) return logger.child(fields)
  const add = (l: Level) => (entry: LogEntry) => logger[l]({ ...fields, ...entry })
  return { debug: add("debug"), info: add("info"), warn: add("warn"), error: add("error"), child: (more) => withFields(logger, { ...fields, ...more }) }
}

function defaultFormat(): LogFormat {
  return (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent === "Cloudflare-Workers" ? "object" : "pretty"
}

function write(level: Level, format: LogFormat, entry: LogEntry): void {
  // Logging never throws: a field JSON cannot hold (a cycle) falls back to the object.
  try {
    const fields = serializeFields(entry)
    if (format === "object") return console[level](fields)
    console[level](format === "json" ? JSON.stringify({ time: new Date().toISOString(), level, ...fields }, jsonValue) : pretty(level, fields))
  } catch {
    console[level](entry)
  }
}

function serializeFields(entry: LogEntry): LogEntry {
  let out: LogEntry | undefined
  for (const key in entry) if (entry[key] instanceof Error) (out ??= { ...entry })[key] = serializeError(entry[key])
  return out ?? entry
}

const jsonValue = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value)

interface SerializedError {
  name: string
  message: string
  stack?: string | undefined
  cause?: unknown
}

const isSerializedError = (value: unknown): value is SerializedError =>
  typeof value === "object" && value !== null && typeof (value as SerializedError).name === "string" && typeof (value as SerializedError).message === "string" && "stack" in value

/** `WARN  msg key=value ..`, then each error's stack and causes. */
function pretty(level: Level, { msg, ...fields }: LogEntry): string {
  let line = `${level.toUpperCase().padEnd(5)} ${msg}`
  let stacks = ""
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    if (isSerializedError(value)) stacks += `\n${stackOf(value)}`
    else line += ` ${key}=${typeof value === "string" && !/[\s"=]/.test(value) ? value : JSON.stringify(value, jsonValue)}`
  }
  return line + stacks
}

function stackOf(error: SerializedError): string {
  const own = error.stack ?? `${error.name}: ${error.message}`
  return isSerializedError(error.cause) ? `${own}\nCaused by: ${stackOf(error.cause)}` : own
}

/**
 * An error as a plain object, following its `cause` chain. Own fields come along, so a
 * DiscordApiError's `status`, `code` and per-field `errors` reach the log.
 */
export function serializeError(error: unknown, depth = 0): unknown {
  if (!(error instanceof Error)) return error
  const out: Record<string, unknown> = { ...error, name: error.name, message: error.message, stack: error.stack }
  if (error.cause !== undefined && depth < 8) out.cause = serializeError(error.cause, depth + 1)
  return out
}
