import type { RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import type { AnyCommand } from "./command.ts"
import type { Context } from "./context.ts"
import { type Credentials, credentialsFromEnv } from "./credentials.ts"
import { AppConfigError } from "./errors.ts"
import type { EventHandler } from "./events.ts"
import { consoleLogger, type Logger, serializeError } from "./log.ts"
import type { Middleware } from "./middleware.ts"
import { handleInteraction } from "./pipeline.ts"
import type { Output } from "./response.ts"
import { fetchTransport, type Transport } from "./transport.ts"
import type { BindingsOf, DataOf, Env, MaybePromise, Platform } from "./types.ts"

export interface AppOptions<E extends Env> {
  /** Credentials, or a loader run once per isolate. Default: `credentialsFromEnv(env)`. */
  credentials?: Credentials | ((env: BindingsOf<E>) => MaybePromise<Credentials>)
  /** Builds the Bot Data once per isolate; `c.data`. */
  data?: (env: BindingsOf<E>) => MaybePromise<DataOf<E>>
  logger?: Logger
  /** Oldest accepted signature timestamp, in seconds. Default 300. */
  maxSignatureAge?: number
  /** Sends REST requests (ADR 0006). Default `fetch`; tests inject a MockTransport. */
  transport?: Transport
  /** Longest 429 wait at runtime, in ms, before throwing. Default 2000. */
  maxRateLimitWait?: number
  /** Path Webhook Events arrive at. Default `/events`. */
  eventsPath?: string
}

/** A Command Definition and the Scope it is synced to (`undefined`: global). */
export interface ScopedDefinition {
  scope: string | undefined
  definition: RESTPostAPIApplicationCommandsJSONBody
}

/** Renders what the user sees when a handler throws. At most one per App tree. */
export type ErrorRenderer<E extends Env = Env> = (error: unknown, c: Context<E>) => MaybePromise<Output>

/** Anything an App lists. */
export type Route<E extends Env = Env> = AnyCommand<E> | App<E>

/** A top-level Command with the middleware around it, outermost first. */
export interface RouteEntry<E extends Env = Env> {
  command: AnyCommand<E>
  chain: Middleware<E>[]
}

/** The App tree flattened for dispatch. */
export interface Built<E extends Env = Env> {
  /** Keyed by `${type}:${name}`. */
  commands: Map<string, RouteEntry<E>>
  /** The root App's middleware: for Interactions no Command answers, and every component and modal submit. */
  middleware: Middleware<E>[]
  onError: ErrorRenderer<E> | undefined
  logger: Logger
  maxSignatureAge: number
  transport: Transport
  maxRateLimitWait: number
  events: EventHandler<E> | undefined
  eventsPath: string
}

interface Resolved<E extends Env> {
  credentials: Credentials
  data: DataOf<E>
}

const INTERNAL = Symbol("composurejs.app")

/**
 * The explicit list of Routes a bot serves, built by chaining (ADR 0001). The single source
 * for dispatch and Sync; Apps nest with {@link App.route}.
 */
export class App<E extends Env = Env> {
  readonly #options: AppOptions<E>
  readonly #routes: Route<E>[] = []
  readonly #middleware: Middleware<E>[] = []
  #onError: ErrorRenderer<E> | undefined
  #events: EventHandler<E> | undefined
  #built: Built<E> | undefined
  #resolved: Promise<Resolved<E>> | undefined

  constructor(options: AppOptions<E> = {}) {
    this.#options = options
  }

  /** Lists a Command, Group, or user/message Command. */
  command(command: AnyCommand<E>): this {
    return this.#add(command)
  }

  /** Lists a nested App and everything it lists. */
  route(app: App<E>): this {
    if (app === this) throw new AppConfigError("An App cannot route to itself")
    return this.#add(app)
  }

  /**
   * Adds middleware around every Route this App lists, nested Apps' included (theirs run
   * inside). Middleware runs in the order added, whether added before or after the Routes.
   */
  use(...middleware: Middleware<E>[]): this {
    this.#middleware.push(...middleware)
    this.#built = undefined
    return this
  }

  /** Sets the Error Renderer. At most one App in a tree may set it. */
  onError(renderer: ErrorRenderer<E>): this {
    if (this.#onError) throw new AppConfigError("onError is already set on this App")
    this.#onError = renderer
    this.#built = undefined
    return this
  }

  /** Answers Webhook Events (ACKed at once, handled as Background Work). At most one App in a tree may set it. */
  events(handler: EventHandler<E>): this {
    if (this.#events) throw new AppConfigError("events is already set on this App")
    this.#events = handler
    this.#built = undefined
    return this
  }

  /** The Command Definitions this tree publishes, with their Scope (none: global). What Sync makes Discord match. */
  definitions(): ScopedDefinition[] {
    return [...this.#build().commands.values()].map(({ command }) => ({ scope: command.topLevel.scope, definition: command.definition() }))
  }

  /** Builds the tree and throws an {@link AppConfigError} for any rule it breaks. Ship it in a test. */
  check(): void {
    this.#build()
  }

  /** Answers one platform request: verify, parse, dispatch, render (ADR 0007). */
  readonly fetch = async (request: Request, env?: BindingsOf<E>, platform?: Platform): Promise<Response> => {
    const logger = this.#options.logger ?? consoleLogger
    const bindings = (env ?? {}) as BindingsOf<E>
    let resolved: Resolved<E>
    try {
      resolved = await this.#resolve(bindings)
    } catch (error) {
      logger.error({ msg: "Loading Credentials or Bot Data failed; retrying on the next request", error: serializeError(error) })
      return new Response("Internal Server Error", { status: 500 })
    }
    try {
      return await handleInteraction(this, request, { ...resolved, env: bindings, platform })
    } catch (error) {
      logger.error({ msg: "Answering the request failed", error: serializeError(error) })
      return new Response("Internal Server Error", { status: 500 })
    }
  }

  /** @internal */
  get [INTERNAL]() {
    return { build: () => this.#build(), loadData: (env: BindingsOf<E>) => this.#loadData(env) }
  }

  #add(route: Route<E>): this {
    this.#routes.push(route)
    this.#built = undefined
    return this
  }

  #resolve(env: BindingsOf<E>): Promise<Resolved<E>> {
    // Once per isolate; a failure is not cached (ADR 0008).
    this.#resolved ??= (async () => {
      const { credentials } = this.#options
      return {
        credentials: typeof credentials === "function" ? await credentials(env) : (credentials ?? credentialsFromEnv(env)),
        data: await this.#loadData(env),
      }
    })().catch((error: unknown) => {
      this.#resolved = undefined
      throw error
    })
    return this.#resolved
  }

  async #loadData(env: BindingsOf<E>): Promise<DataOf<E>> {
    return (await this.#options.data?.(env)) as DataOf<E>
  }

  #build(): Built<E> {
    if (this.#built) return this.#built
    const logger = this.#options.logger ?? consoleLogger
    const built: Built<E> = {
      commands: new Map(),
      middleware: [...this.#middleware],
      onError: undefined,
      logger,
      maxSignatureAge: this.#options.maxSignatureAge ?? 300,
      transport: this.#options.transport ?? fetchTransport,
      maxRateLimitWait: this.#options.maxRateLimitWait ?? 2000,
      events: undefined,
      eventsPath: this.#options.eventsPath ?? "/events",
    }
    const seen = new Map<string, string>()
    let onErrorAt: string | undefined
    let eventsAt: string | undefined

    const visit = (app: App<E>, path: string, stack: Set<App<E>>, outer: Middleware<E>[]) => {
      if (stack.has(app)) throw new AppConfigError(`${path}: Apps route to each other in a cycle`)
      stack.add(app)
      const chain = [...outer, ...app.#middleware]
      if (app !== this && (app.#options.credentials || app.#options.data)) {
        logger.warn({ msg: "credentials and data on a nested App are ignored; set them on the root App", path })
      }
      if (app.#onError) {
        if (onErrorAt) throw new AppConfigError(`onError is set twice in one App tree: at ${onErrorAt} and at ${path}`)
        onErrorAt = path
        built.onError = app.#onError
      }
      if (app.#events) {
        // A bot has one events URL (composure-rs ADR 0013).
        if (eventsAt) throw new AppConfigError(`events is set twice in one App tree: at ${eventsAt} and at ${path}`)
        eventsAt = path
        built.events = app.#events
      }
      app.#routes.forEach((route, index) => {
        const at = `${path}.route[${index}]`
        if (route instanceof App) return visit(route, at, stack, chain)
        const key = `${route.type}:${route.name}`
        const first = seen.get(key)
        if (first) throw new AppConfigError(`${describe(route)} is listed twice: at ${first} and at ${at}`)
        seen.set(key, at)
        built.commands.set(key, { command: route, chain })
      })
      stack.delete(app)
    }
    visit(this, "app", new Set(), [])
    this.#built = built
    return built
  }
}

function describe(command: AnyCommand<any>): string {
  if (command.kind === "user") return `User Command "${command.name}"`
  if (command.kind === "message") return `Message Command "${command.name}"`
  return `Command "/${command.name}"`
}

/** @internal Pipeline and testing access to an App's build and loaders. */
export function internals<E extends Env>(app: App<E>) {
  return app[INTERNAL]
}
