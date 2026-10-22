// Inline Handlers (ADR 0015). @composurejs/vite hoists every `onClick` / `onSelect` / `onSubmit`
// written as a function into a module-level `__handler(id, captures, make, where)` and rewrites its
// site to `ref.bind([values])`. Registering happens when the module loads, so every handler a bot's
// bundle contains is known before its first click. A `custom_id` is `id:capturedValue:..`.
import type { APIInteractionDataResolved, APIMessageComponentInteraction, APIModalSubmitInteraction } from "discord-api-types/v10"
import { decodeValue, encodeValue, FAIL, type Fail, joinFields, prefixOf, splitFields } from "./codec.ts"
import type { Context } from "./context.ts"
import { RenderError } from "./errors.ts"
import type { Output } from "./response.ts"
import type { Env, MaybePromise } from "./types.ts"

export type ComponentContext<E extends Env = Env> = Context<E, APIMessageComponentInteraction>
export type ModalContext<E extends Env = Env> = Context<E, APIModalSubmitInteraction>

/** The `custom_id` of a placed handler. */
export type HandlerRef = string & {}

type Bivariant<A extends unknown[], R> = { bivarianceHack(...args: A): R }["bivarianceHack"]

/** `onClick`: answers a button click. Returning a View updates the clicked message. */
export type ClickHandler = Bivariant<[c: ComponentContext<any>], MaybePromise<Output>>
/** `onSelect`: answers a select; annotate `values` to type them (`(c, values: Topping[]) => ..`). */
export type SelectHandler = Bivariant<[c: ComponentContext<any>, values: string[]], MaybePromise<Output>>
/** `onSubmit`: answers a modal; `values` by input `name`, annotate them (`(c, v: { reason: string }) => ..`). */
export type SubmitHandler = Bivariant<[c: ModalContext<any>, values: ModalValues], MaybePromise<Output>>

/**
 * Submitted values by input `name`: a string for text inputs and radio groups (`undefined` when
 * left empty), a boolean for checkboxes, a list for selects and checkbox groups, resolved
 * attachments for file uploads.
 */
export type ModalValues = Record<string, unknown>

interface Handler {
  readonly id: string
  readonly captures: readonly string[]
  readonly where: string
  make(captures: Record<string, any>): (...args: any[]) => unknown
}

const registry = new Map<string, Handler>()

const PLUGIN_HINT = "Inline Handlers are compiled by @composurejs/vite, which must be in the build (vite.config.ts: plugins: [composure()])"

/** @internal The call @composurejs/vite writes for each Inline Handler. */
export function __handler(id: string, captures: readonly string[], make: Handler["make"], where = id) {
  const existing = registry.get(id)
  // The same module evaluated again (HMR, tests) replaces its own handlers; another module may not.
  if (existing && existing.where.split(":")[0] !== where.split(":")[0]) {
    throw new RenderError(`Handler id "${id}" is used twice: in ${existing.where} and in ${where}`)
  }
  registry.set(id, { id, captures, make, where })
  return {
    /** The `custom_id` carrying the captured values, checked for the 100-character limit at render. */
    bind(values: readonly unknown[]): HandlerRef {
      const fields = values.map((value, i) => {
        const encoded = encodeValue(value)
        if (encoded === undefined) {
          const path = captures[i]
          const hint =
            typeof value === "function"
              ? "define it at module scope, where the hoisted handler can reach it"
              : `capture strings, numbers or booleans (like \`${path}.id\`), or load the rest from an id inside the handler`
          throw new RenderError(`The handler in ${where} captures \`${path}\`, which is ${describe(value)}; ${hint}`)
        }
        return encoded
      })
      return fields.length > 0 ? `${id}:${joinFields(fields)}` : id
    },
  }
}

const describe = (value: unknown) =>
  Array.isArray(value) ? "an array" : typeof value === "function" ? "a function" : typeof value === "object" ? "an object" : `a ${typeof value} that cannot be carried`

/**
 * Gives an Inline Handler a stable id of your choosing: `onClick={named("toggle-role", (c) => ..)}`.
 * Generated ids change when the handler moves or captures something new, turning buttons already
 * sent into "outdated"; name the handlers of messages meant to last (role menus, polls).
 */
export function named<F extends (...args: any[]) => unknown>(id: string, handler: F): F {
  void handler
  throw new RenderError(`named("${id}", ..): ${PLUGIN_HINT}`)
}

/**
 * Thrown at render when an `on*` prop is still a function. The plugin compiles every handler it
 * can see, so either it is not in the build or the function arrived some way it cannot follow.
 */
export function uncompiledHandler(prop: string): RenderError {
  return new RenderError(
    `${prop} got a function the build did not compile. Write the handler inline, at module scope, or with named("id", ..), and pass handler props on unchanged; otherwise check that @composurejs/vite is in the build (vite.config.ts: plugins: [composure()])`,
  )
}

/** Runs the handler a `custom_id` addresses; FAIL when it is unknown or its values do not decode (the Fallback answers). */
export async function dispatchHandler(c: Context<any, any>, customId: string): Promise<Output | Fail> {
  const [id, rest] = prefixOf(customId)
  const handler = registry.get(id)
  const fields = rest === undefined ? [] : splitFields(rest)
  if (!handler || !fields || fields.length !== handler.captures.length) return FAIL

  const captures: Record<string, unknown> = {}
  for (let i = 0; i < fields.length; i++) {
    const value = decodeValue(fields[i]!)
    if (value === FAIL) return FAIL
    setPath(captures, handler.captures[i]!, value)
  }
  const interaction = c.interaction as APIMessageComponentInteraction | APIModalSubmitInteraction
  const data = interaction.data as { values?: unknown; components?: unknown[]; resolved?: APIInteractionDataResolved }
  const extra = interaction.type === 5 ? modalValues(data.components, data.resolved) : Array.isArray(data.values) ? data.values : []
  return (await handler.make(captures)(c, extra)) as Output
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".")
  let at = target
  for (const key of keys.slice(0, -1)) at = (at[key] ??= {}) as Record<string, unknown>
  at[keys[keys.length - 1]!] = value
}

interface Submitted {
  type?: number
  custom_id?: string
  value?: unknown
  values?: unknown[]
  component?: Submitted
  components?: Submitted[]
}

/** A modal submission's values by input `custom_id` (its `name`), from Labels and legacy Action Rows. */
export function modalValues(components: readonly unknown[] | undefined, resolved: APIInteractionDataResolved | undefined): ModalValues {
  const out: ModalValues = {}
  const visit = (c: Submitted) => {
    if (typeof c.custom_id === "string") out[c.custom_id] = valueOf(c, resolved)
    if (c.component) visit(c.component)
    for (const child of c.components ?? []) visit(child)
  }
  for (const c of components ?? []) visit(c as Submitted)
  return out
}

function valueOf(input: Submitted, resolved: APIInteractionDataResolved | undefined): unknown {
  if (input.type === 19) return (input.values ?? []).map((id) => resolved?.attachments?.[id as string]).filter(Boolean)
  if (typeof input.value === "boolean") return input.value
  if (Array.isArray(input.values)) return input.values
  return typeof input.value === "string" && input.value !== "" ? input.value : undefined
}
