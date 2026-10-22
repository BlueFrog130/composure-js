/**
 * Structured logger. Each call gets one object, which Workers Logs indexes by field.
 * Never pass the Interaction token, a URL holding it, or Custom ID State.
 */
export interface Logger {
  debug(entry: LogEntry): void
  info(entry: LogEntry): void
  warn(entry: LogEntry): void
  error(entry: LogEntry): void
}

export interface LogEntry {
  msg: string
  [field: string]: unknown
}

export const consoleLogger: Logger = {
  debug: (entry) => console.debug(entry),
  info: (entry) => console.info(entry),
  warn: (entry) => console.warn(entry),
  error: (entry) => console.error(entry),
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
