// Bun Adapter (ADR 0007). Bun calls a default export's `fetch(request, server)`, so the App is
// wrapped to pass `process.env` and a Tracker instead of the server.
import { type App, type BindingsOf, createTracker, type Env, type Tracker } from "composurejs"
import { onShutdown, SHUTDOWN_GRACE_MS } from "./shutdown.ts"

export interface HandleOptions<E extends Env> {
  port?: number
  hostname?: string
  /** Env passed to the App. Default `process.env`. */
  env?: BindingsOf<E>
  /** How long shutdown waits for Background Work, in ms. Default 30s. */
  shutdownGrace?: number
  /** Wait for Background Work on SIGTERM/SIGINT. Default true. */
  handleSignals?: boolean
}

export interface BunHandler {
  port?: number
  hostname?: string
  fetch(request: Request): Promise<Response>
  readonly platform: Tracker
}

/** `export default handle(app)` from the Bun entry. */
export function handle<E extends Env>(app: App<E>, options: HandleOptions<E> = {}): BunHandler {
  const { env = process.env as BindingsOf<E>, shutdownGrace = SHUTDOWN_GRACE_MS, handleSignals = true } = options
  const platform = createTracker()
  if (handleSignals) onShutdown(() => platform.settle(shutdownGrace).then(() => {}))
  return {
    ...(options.port !== undefined && { port: options.port }),
    ...(options.hostname !== undefined && { hostname: options.hostname }),
    fetch: (request) => app.fetch(request, env, platform),
    platform,
  }
}
