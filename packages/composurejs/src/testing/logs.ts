import type { LogEntry, LogFields, Logger } from "../log.ts";

/** One recorded entry: its level, the fields bound by `child`, and the entry. */
export interface RecordedLog extends LogEntry {
  level: "debug" | "info" | "warn" | "error";
}

/** A Logger that keeps every entry, for asserting on logs: `new App({ logger: logs.logger })`. */
export function recordLogs(): { logger: Logger; entries: RecordedLog[] } {
  const entries: RecordedLog[] = [];
  const make = (fields: LogFields): Logger => {
    const at = (level: RecordedLog["level"]) => (entry: LogEntry) => void entries.push({ level, ...fields, ...entry });
    return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error"), child: (more) => make({ ...fields, ...more }) };
  };
  return { logger: make({}), entries };
}
