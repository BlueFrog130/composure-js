import type { Platform } from "./types.ts"

/** A Platform for long-running servers: Background Work is tracked so shutdown can await it. */
export interface Tracker extends Required<Platform> {
  /** Promises still running. */
  readonly pending: number
  /** Waits for tracked work, up to `timeoutMs`; `true` if it all settled in time. */
  settle(timeoutMs: number): Promise<boolean>
}

export function createTracker(): Tracker {
  const running = new Set<Promise<unknown>>()
  return {
    get pending() {
      return running.size
    },
    waitUntil(promise) {
      const tracked = promise.then(
        () => {},
        () => {},
      )
      running.add(tracked)
      void tracked.finally(() => running.delete(tracked))
    },
    async settle(timeoutMs) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<false>((resolve) => (timer = setTimeout(resolve, timeoutMs, false)))
      // Work can schedule more work, so drain until nothing is left.
      const drain = (async () => {
        while (running.size > 0) await Promise.all(running)
        return true
      })()
      const settled = await Promise.race([drain, timeout])
      clearTimeout(timer)
      return settled
    },
  }
}
