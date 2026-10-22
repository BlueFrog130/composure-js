// The same file is in adapter-node and adapter-bun; change both.
/** Default time Background Work gets to finish on shutdown (ADR 0007). */
export const SHUTDOWN_GRACE_MS = 30_000

/**
 * Runs `close` on the first SIGTERM or SIGINT, then re-raises the signal so the process ends
 * as it would have. Returns a function removing the listeners.
 */
export function onShutdown(close: () => Promise<void>): () => void {
  const signals = ["SIGTERM", "SIGINT"] as const
  const handler = (signal: NodeJS.Signals) => {
    remove()
    void close().finally(() => process.kill(process.pid, signal))
  }
  const remove = () => signals.forEach((s) => process.off(s, handler))
  signals.forEach((s) => process.once(s, handler))
  return remove
}
