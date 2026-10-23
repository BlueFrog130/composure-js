/**
 * The App's type parameters, as in Hono: the platform's Env bindings, the Bot Data, and the
 * middleware Variables. Every key is optional.
 */
export interface Env {
  Bindings?: object;
  Data?: unknown;
  Variables?: object;
}

export type BindingsOf<E extends Env> = E extends { Bindings: infer B extends object } ? B : Record<string, unknown>;
export type DataOf<E extends Env> = E extends { Data: infer D } ? D : undefined;
export type VariablesOf<E extends Env> = E extends { Variables: infer V extends object } ? V : Record<string, unknown>;

/** What the entry hands core per request beyond the Env (ADR 0007). */
export interface Platform {
  /** Keeps the isolate or process alive until `promise` settles (Background Work). */
  waitUntil?(promise: Promise<unknown>): void;
}

export type MaybePromise<T> = T | Promise<T>;
