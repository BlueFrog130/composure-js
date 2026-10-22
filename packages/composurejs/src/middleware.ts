import type { Context } from "./context.ts"
import { ResponseError } from "./errors.ts"
import type { Output } from "./response.ts"
import type { Env, MaybePromise } from "./types.ts"

/** Runs the rest of the chain (inner middleware, then the Route) and resolves to its Output. */
export type Next = () => Promise<Output>

/**
 * Wraps dispatch, in onion order, for every Interaction kind except Ping. Return an Output to
 * short-circuit (or to replace the inner result); return nothing to pass on what `next()` gave.
 */
export type Middleware<E extends Env = Env> = (c: Context<E>, next: Next) => MaybePromise<Output | void>

/** Types a middleware for an App's Env without listing it. */
export function middleware<E extends Env = Env>(fn: Middleware<E>): Middleware<E> {
  return fn
}

/** Runs `route` inside `chain`, outermost first. */
export function runChain<E extends Env>(chain: readonly Middleware<E>[], c: Context<E>, route: () => MaybePromise<Output>): Promise<Output> {
  const at = async (i: number): Promise<Output> => {
    const mw = chain[i]
    if (!mw) return route()
    let inner: Promise<Output> | undefined
    const next: Next = () => {
      if (inner) return Promise.reject(new ResponseError("A middleware called next() twice"))
      return (inner = at(i + 1))
    }
    const out = await mw(c, next)
    if (out !== undefined) return out
    if (inner) return inner
    throw new ResponseError("A middleware returned nothing without calling next()")
  }
  return at(0)
}
