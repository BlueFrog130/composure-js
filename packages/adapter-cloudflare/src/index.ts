// Cloudflare Workers Adapter (ADR 0007). `export default app` already fits the Workers fetch
// handler; `handle` names the shape and is where `scheduled` and friends will hang.
import type { App, BindingsOf, Env } from "composurejs"

/** The part of Workers' `ExecutionContext` the Adapter uses. */
export interface ExecutionContext {
  /** Background Work; bounded to about 30s after the response. */
  waitUntil(promise: Promise<unknown>): void
}

export interface WorkerHandler<E extends Env> {
  fetch(request: Request, env: BindingsOf<E>, ctx: ExecutionContext): Promise<Response>
}

/** `export default handle(app)` from the Worker entry. */
export function handle<E extends Env>(app: App<E>): WorkerHandler<E> {
  return { fetch: (request, env, ctx) => app.fetch(request, env, ctx) }
}
