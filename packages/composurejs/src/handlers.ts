// Component Handlers, Modal Handlers and Views (ADR 0005, 0009). A `custom_id` is
// `prefix[:state..]` for handlers defined outside render, and `prefix:name:captures..` for a
// View's Inline Handlers, which @composurejs/vite hoists out of render.
import type { APIInteractionDataResolved, APIMessageComponentInteraction, APIModalSubmitInteraction } from "discord-api-types/v10"
import {
  type Codecs,
  type CodecValues,
  decodePrimitive,
  decodeState,
  encodePrimitive,
  encodeState,
  checkPrefix,
  FAIL,
  type Fail,
  joinFields,
  splitFields,
} from "./codec.ts"
import type { Context } from "./context.ts"
import { RenderError } from "./errors.ts"
import { type FieldRefs, fieldRefs, type Fields, type FieldValues, parseFields, submittedInputs } from "./fields.ts"
import type { JSX } from "./jsx-runtime.ts"
import { type Child, createNode, isNode } from "./jsx/node.ts"
import type { Output } from "./response.ts"
import type { Env, MaybePromise } from "./types.ts"

export type ComponentContext<E extends Env = Env> = Context<E, APIMessageComponentInteraction>
export type ModalContext<E extends Env = Env> = Context<E, APIModalSubmitInteraction>

/** What render threads through Views: which handler prefixes were placed, and field bindings to check. */
export interface RenderContext {
  handlerPrefixes: Set<string>
  fieldChecks: { owner: string; fields: Fields }[]
}

/** A node render expands when it meets it (Views, opened modals). `view` marks a View for re-rendering. */
export interface ExpandProps {
  expand(ctx: RenderContext): Promise<unknown>
  view?: View<any, any, any>
}

export function isViewNode(value: unknown): boolean {
  return isNode(value) && value.tag === "Expand" && (value.props as unknown as ExpandProps).view !== undefined
}

const stateId = (prefix: string, codecs: Codecs, state: object) =>
  Object.keys(codecs).length === 0 ? prefix : `${prefix}:${joinFields(encodeState(codecs, state as never))}`

type StateArgs<S extends Codecs> = keyof S extends never ? [] : [state: CodecValues<S>]

// ---- Component Handlers --------------------------------------------------------------------

export interface ComponentConfig<S extends Codecs, E extends Env> {
  /** Custom ID State: carried in the `custom_id`, typed by Codecs (`p.*`). */
  state?: S
  /** `values` holds a select's chosen values (empty for buttons). */
  handler(c: ComponentContext<E>, state: CodecValues<S>, values: string[]): MaybePromise<Output>
}

/** Answers clicks and selections on components whose `custom_id` starts with its prefix. */
export interface ComponentHandler<S extends Codecs = Codecs, E extends Env = Env> {
  readonly kind: "component"
  readonly prefix: string
  readonly state: S
  handler(c: ComponentContext<E>, state: CodecValues<S>, values: string[]): MaybePromise<Output>
  /** The `custom_id` for `customId=` / `onClick=` / `onSelect=`. */
  id(...state: StateArgs<S>): string
}

/** Defines a Component Handler; place it with `<Button onClick={vote.id({ poll, up: true })}>`. */
export function component<S extends Codecs = {}, E extends Env = Env>(prefix: string, config: ComponentConfig<S, E>): ComponentHandler<S, E> {
  checkPrefix("Component Handler", prefix)
  const state = config.state ?? ({} as S)
  return {
    kind: "component",
    prefix,
    state,
    handler: config.handler,
    id: (...args) => stateId(prefix, state, args[0] ?? {}),
  }
}

// ---- Modal Handlers ------------------------------------------------------------------------

export interface ModalConfig<S extends Codecs, F extends Fields, E extends Env> {
  state?: S
  /** The fields; render binds one input to each with `field={fields.x}`. */
  fields: F
  /** The `<Modal>`; its `customId` is set for you. */
  render(state: CodecValues<S>, fields: FieldRefs<F>): JSX.Element
  handler(c: ModalContext<E>, values: FieldValues<F>, state: CodecValues<S>): MaybePromise<Output>
}

/** Answers submits of the modal it renders. */
export interface ModalHandler<S extends Codecs = Codecs, F extends Fields = Fields, E extends Env = Env> {
  readonly kind: "modal"
  readonly prefix: string
  readonly state: S
  readonly fields: F
  handler(c: ModalContext<E>, values: FieldValues<F>, state: CodecValues<S>): MaybePromise<Output>
  /** The modal to answer with (opens it). */
  open(...state: StateArgs<S>): JSX.Element
}

/** Defines a modal and its submit handler; answer with `feedback.open({ page })`. */
export function modal<S extends Codecs = {}, F extends Fields = {}, E extends Env = Env>(prefix: string, config: ModalConfig<S, F, E>): ModalHandler<S, F, E> {
  checkPrefix("Modal Handler", prefix)
  const state = config.state ?? ({} as S)
  const refs = fieldRefs(config.fields)
  return {
    kind: "modal",
    prefix,
    state,
    fields: config.fields,
    handler: config.handler,
    open: (...args) => {
      const values = (args[0] ?? {}) as CodecValues<S>
      const props: ExpandProps = {
        expand: async (ctx) => {
          const root = await config.render(values, refs)
          if (!isNode(root) || root.tag !== "Modal") throw new RenderError(`modal("${prefix}") must render a <Modal>`)
          if (root.props.customId !== undefined || root.props.onSubmit !== undefined) {
            throw new RenderError(`modal("${prefix}") sets the <Modal>'s customId itself; leave customId and onSubmit out`)
          }
          ctx.fieldChecks.push({ owner: `modal "${prefix}"`, fields: config.fields })
          return createNode("Modal", { ...root.props, customId: stateId(prefix, state, values) })
        },
      }
      return createNode("Expand", props as unknown as Record<string, unknown>)
    },
  }
}

// ---- Views ---------------------------------------------------------------------------------

/** One Inline Handler as @composurejs/vite hoists it. The contract between the plugin and core. */
export interface HoistedHandler {
  /** Captured Props as `[local path, prop]` (`["title", "title"]`, `["props.title", "title"]`); prop `"*"` binds the whole Props object. */
  readonly props: readonly (readonly [string, string])[]
  /** Captured member chains of render locals (`"item.id"`), encoded as primitives. */
  readonly locals: readonly string[]
  /** Rebuilds the handler from its decoded captures. */
  make(captures: Record<string, any>): (...args: any[]) => unknown
}

type Bivariant<A extends unknown[], R> = { bivarianceHack(...args: A): R }["bivarianceHack"]

/** A View's `on`: names an Inline Handler. In a modal View (with fields) handlers get the field values. */
export interface On<E extends Env, F extends Fields> {
  (
    name: string,
    handler: keyof F extends never
      ? Bivariant<[c: ComponentContext<E>, values: string[]], MaybePromise<Output>>
      : Bivariant<[c: ModalContext<E>, values: FieldValues<F>], MaybePromise<Output>>,
  ): string
}

export interface ViewConfig<P extends Codecs, F extends Fields, E extends Env> {
  /** Props as Codecs (`p.*`): what the View renders from, and what its handlers may capture. */
  props?: P
  /** Makes a modal View: the submitted values its `onSubmit` handlers receive. */
  fields?: F
  /** Pure (optionally async) markup from Props. Runs on every render, never on clicks. */
  render(props: CodecValues<P>, on: On<E, F>, fields: FieldRefs<F>): Child | Promise<Child>
  /** Written by @composurejs/vite; never set by hand. */
  handlers?: Record<string, HoistedHandler>
}

/** A View: call it (or use it as a tag) with Props to place its markup. */
export interface View<P extends Codecs = Codecs, F extends Fields = Fields, E extends Env = Env> {
  (props: CodecValues<P>): JSX.Element
  readonly kind: "view"
  readonly prefix: string
  readonly config: ViewConfig<P, F, E>
}

/**
 * Defines a View. Inline Handlers (`onClick={on("like", () => ..)}`) need the @composurejs/vite
 * plugin; list Views that have them with `app.view(..)`.
 */
export function view<P extends Codecs = {}, F extends Fields = {}, E extends Env = Env>(prefix: string, config: ViewConfig<P, F, E>): View<P, F, E> {
  checkPrefix("View", prefix)
  const codecs = config.props ?? ({} as P)
  const refs = fieldRefs(config.fields ?? ({} as F))
  const self = ((props: CodecValues<P>) => {
    const node: ExpandProps = {
      view: self,
      expand: async (ctx): Promise<unknown> => {
        for (const [key, codec] of Object.entries(codecs as Codecs)) {
          if (!codec.isOptional && (props as Record<string, unknown>)[key] === undefined) throw new RenderError(`View "${prefix}" is missing prop "${key}"`)
        }
        if (config.fields) ctx.fieldChecks.push({ owner: `View "${prefix}"`, fields: config.fields })
        return await (config.render(props, makeOn(self, props as Record<string, unknown>, ctx) as On<E, F>, refs) as unknown)
      },
    }
    return createNode("Expand", node as unknown as Record<string, unknown>)
  }) as View<P, F, E>
  return Object.assign(self, { kind: "view" as const, prefix, config })
}

const PLUGIN_HINT =
  "Inline Handlers need the @composurejs/vite plugin, which hoists them out of render (vite.config.ts: plugins: [composure()]; Vitest uses it too). Without Vite, define the handler with component() or modal()."

function makeOn(view: View<any, any, any>, props: Record<string, unknown>, ctx: RenderContext) {
  const on = (name: string) => {
    throw new RenderError(`View "${view.prefix}", handler "${name}": ${PLUGIN_HINT}`)
  }
  // The call the plugin writes in place of `on(name, closure)`.
  on.$ = (name: string, locals: readonly unknown[]) => {
    const hoisted = view.config.handlers?.[name]
    if (!hoisted) throw new RenderError(`View "${view.prefix}" has no handler "${name}". ${PLUGIN_HINT}`)
    const codecs = view.config.props ?? {}
    const fields = [name]
    for (const [, prop] of hoisted.props) {
      if (prop === "*") for (const [key, codec] of Object.entries(codecs as Codecs)) fields.push(codec.encode(props[key]))
      else fields.push(codecs[prop]!.encode(props[prop]))
    }
    locals.forEach((value, i) => {
      const encoded = encodePrimitive(value)
      if (encoded === undefined) {
        const path = hoisted.locals[i]
        throw new RenderError(`Handler "${name}" in View "${view.prefix}" captures \`${path}\`, which is an object; capture a string, number or boolean from it, like \`${path}.id\``)
      }
      fields.push(encoded)
    })
    ctx.handlerPrefixes.add(view.prefix)
    return `${view.prefix}:${joinFields(fields)}`
  }
  return on
}

// ---- Dispatch ------------------------------------------------------------------------------

export type ComponentRoute = ComponentHandler<any, any> | ModalHandler<any, any, any> | View<any, any, any>

/** Runs the route a `custom_id` addresses; FAIL when its state is outdated (the Fallback answers). */
export async function dispatchComponent(route: ComponentRoute, c: Context<any, any>, rest: string | undefined): Promise<Output | Fail> {
  const fields = rest === undefined ? [] : splitFields(rest)
  if (!fields) return FAIL
  const interaction = c.interaction as APIMessageComponentInteraction | APIModalSubmitInteraction
  const isModal = interaction.type === 5

  if (route.kind === "component") {
    if (isModal) return FAIL
    const state = decodeState(route.state, fields)
    if (state === FAIL) return FAIL
    return route.handler(c, state, valuesOf(interaction))
  }
  if (route.kind === "modal") {
    if (!isModal) return FAIL
    const state = decodeState(route.state, fields)
    const values = parseFields(route.fields, submittedInputs(interaction.data.components), (interaction.data as { resolved?: APIInteractionDataResolved }).resolved)
    if (state === FAIL || values === FAIL) return FAIL
    return route.handler(c, values, state)
  }

  const [name, ...state] = fields
  const hoisted = name === undefined ? undefined : route.config.handlers?.[name]
  if (!hoisted) return FAIL
  const captures = decodeCaptures(route, hoisted, state)
  if (captures === FAIL) return FAIL
  let extra: unknown = valuesOf(interaction)
  if (isModal) {
    extra = parseFields(route.config.fields ?? {}, submittedInputs(interaction.data.components), (interaction.data as { resolved?: APIInteractionDataResolved }).resolved)
    if (extra === FAIL) return FAIL
  }
  return (await hoisted.make(captures)(c, extra)) as Output
}

function valuesOf(interaction: APIMessageComponentInteraction | APIModalSubmitInteraction): string[] {
  const values = (interaction.data as { values?: unknown }).values
  return Array.isArray(values) ? (values as string[]) : []
}

function decodeCaptures(route: View<any, any, any>, hoisted: HoistedHandler, state: readonly string[]): Record<string, unknown> | Fail {
  const codecs: Codecs = route.config.props ?? {}
  const captures: Record<string, unknown> = {}
  let i = 0
  for (const [local, prop] of hoisted.props) {
    if (prop === "*") {
      const whole = decodeState(codecs, state.slice(i, i + Object.keys(codecs).length))
      if (whole === FAIL) return FAIL
      i += Object.keys(codecs).length
      setPath(captures, local, whole)
      continue
    }
    const codec = codecs[prop]
    const text = state[i++]
    if (!codec || text === undefined) return FAIL
    const value = codec.decode(text)
    if (value === FAIL) return FAIL
    setPath(captures, local, value)
  }
  for (const path of hoisted.locals) {
    const text = state[i++]
    if (text === undefined) return FAIL
    const value = decodePrimitive(text)
    if (value === FAIL) return FAIL
    setPath(captures, path, value)
  }
  return i === state.length ? captures : FAIL
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".")
  let at = target
  for (const key of keys.slice(0, -1)) at = (at[key] ??= {}) as Record<string, unknown>
  at[keys[keys.length - 1]!] = value
}

