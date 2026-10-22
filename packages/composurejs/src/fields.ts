// Modal fields: a schema types the submitted values, and markup binds inputs to it with
// `field={fields.x}`. TypeScript cannot read values from JSX children, so the schema leads.
import type { APIInteractionDataResolved } from "discord-api-types/v10"
import { FAIL, type Fail } from "./codec.ts"
import type { Attachment, Choices } from "./options.ts"

export type FieldKind = "text" | "choice" | "choices" | "checkbox" | "users" | "roles" | "channels" | "mentionables" | "files"

export interface FieldSpec {
  readonly kind: FieldKind
  readonly required: boolean
  readonly choices?: Choices<string> | undefined
  /** Defaults the bound input takes unless its own props say otherwise. */
  readonly input: Readonly<Record<string, unknown>>
}

/** A modal field. `T` is the submitted value, `R` whether the input is required. */
export class Field<T, R extends boolean = true> {
  declare readonly __value: T
  declare readonly __required: R

  constructor(readonly spec: FieldSpec) {}

  /** The user may leave it empty: `undefined` for single values, `[]` for lists. */
  optional(): Field<T extends readonly unknown[] ? T : T | undefined, false> {
    if (this.spec.kind === "checkbox") throw new Error("A checkbox is never required, so it cannot be optional")
    return new Field({ ...this.spec, required: false })
  }
}

export type AnyField = Field<any, boolean>
export type Fields = Record<string, AnyField>

type Simplify<T> = { [K in keyof T]: T[K] } & {}

export type FieldValues<F extends Fields> = Simplify<{ [K in keyof F]: F[K]["__value"] }>

const FIELD = Symbol.for("composurejs.field")

/** What `fields.x` is in markup: binds an input to field `x`. */
export interface FieldRef {
  readonly [FIELD]: true
  readonly name: string
  readonly spec: FieldSpec
}

export type FieldRefs<F extends Fields> = { readonly [K in keyof F]: FieldRef }

export function fieldRefs<F extends Fields>(fields: F): FieldRefs<F> {
  return Object.fromEntries(Object.entries(fields).map(([name, f]) => [name, { [FIELD]: true, name, spec: f.spec }])) as FieldRefs<F>
}

export function isFieldRef(value: unknown): value is FieldRef {
  return typeof value === "object" && value !== null && FIELD in value
}

const make = <T>(kind: FieldKind, input: Record<string, unknown> = {}, choices?: Choices<string>) =>
  new Field<T>({ kind, required: kind !== "checkbox", input, ...(choices && { choices }) })

const range = ({ min, max }: { min?: number; max?: number }) => ({
  ...(min !== undefined && { minValues: min }),
  ...(max !== undefined && { maxValues: max }),
})

/** Field builders for modals: bind with `<TextInput field={fields.what} />`, `<RadioGroup field={..} />`, ... */
export const f = {
  /** A `<TextInput>`. */
  text: (input: { paragraph?: boolean; minLength?: number; maxLength?: number; placeholder?: string; value?: string } = {}) => make<string>("text", input),
  /** One of `choices`: a `<RadioGroup>` or single `<StringSelect>`. */
  choice: <const V extends string>(choices: Choices<V>) => make<V>("choice", {}, choices),
  /** Any of `choices`: a `<CheckboxGroup>` or multi `<StringSelect>`. */
  choices: <const V extends string>(choices: Choices<V>, limits: { min?: number; max?: number } = {}) => make<V[]>("choices", range(limits), choices),
  /** A `<Checkbox>`; never required. */
  checkbox: () => make<boolean>("checkbox"),
  /** User ids from a `<UserSelect>`. */
  users: (limits: { min?: number; max?: number } = {}) => make<string[]>("users", range(limits)),
  roles: (limits: { min?: number; max?: number } = {}) => make<string[]>("roles", range(limits)),
  channels: (limits: { min?: number; max?: number; types?: number[] } = {}) =>
    make<string[]>("channels", { ...range(limits), ...(limits.types && { channelTypes: limits.types }) }),
  mentionables: (limits: { min?: number; max?: number } = {}) => make<string[]>("mentionables", range(limits)),
  /** Files from a `<FileUpload>`, resolved. */
  files: (limits: { min?: number; max?: number; types?: string[] } = {}) =>
    make<Attachment[]>("files", { ...range(limits), ...(limits.types && { fileTypes: limits.types }) }),
}

/** Which input tags may bind each field kind. */
export const FIELD_INPUTS: Record<FieldKind, readonly string[]> = {
  text: ["TextInput"],
  choice: ["RadioGroup", "StringSelect"],
  choices: ["CheckboxGroup", "StringSelect"],
  checkbox: ["Checkbox"],
  users: ["UserSelect"],
  roles: ["RoleSelect"],
  channels: ["ChannelSelect"],
  mentionables: ["MentionableSelect"],
  files: ["FileUpload"],
}

interface Submitted {
  value?: unknown
  values?: unknown[]
}

/** The submitted inputs by `custom_id`, from Labels and legacy Action Rows. */
export function submittedInputs(components: readonly unknown[] | undefined): Map<string, Submitted> {
  const out = new Map<string, Submitted>()
  const visit = (c: { custom_id?: string; component?: unknown; components?: unknown[] } & Submitted) => {
    if (typeof c.custom_id === "string") out.set(c.custom_id, c)
    if (c.component) visit(c.component as typeof c)
    for (const child of c.components ?? []) visit(child as typeof c)
  }
  for (const c of components ?? []) visit(c as never)
  return out
}

/** The handler's values; FAIL when the submission does not match the fields (an outdated modal). */
export function parseFields<F extends Fields>(fields: F, inputs: Map<string, Submitted>, resolved: APIInteractionDataResolved | undefined): FieldValues<F> | Fail {
  const out: Record<string, unknown> = {}
  for (const [name, { spec }] of Object.entries(fields)) {
    const input = inputs.get(name)
    const value = parseField(spec, input, resolved)
    if (value === FAIL) return FAIL
    out[name] = value
  }
  return out as FieldValues<F>
}

function parseField(spec: FieldSpec, input: Submitted | undefined, resolved: APIInteractionDataResolved | undefined): unknown {
  const allowed = spec.choices && new Set<string>(spec.choices.map((c) => c.value))
  const list = Array.isArray(input?.values) ? input.values : undefined
  switch (spec.kind) {
    case "checkbox":
      return input?.value === true
    case "text": {
      const text = typeof input?.value === "string" && input.value !== "" ? input.value : undefined
      return text === undefined && spec.required ? FAIL : text
    }
    case "choice": {
      const value = typeof input?.value === "string" ? input.value : list?.[0]
      if (value === undefined || value === null) return spec.required ? FAIL : undefined
      return typeof value === "string" && allowed?.has(value) ? value : FAIL
    }
    case "files": {
      const files = (list ?? []).map((id) => resolved?.attachments?.[id as string])
      if (files.some((f) => !f) || (spec.required && files.length === 0)) return FAIL
      return files
    }
    default: {
      const values = list ?? []
      if (values.some((v) => typeof v !== "string") || (spec.required && values.length === 0)) return FAIL
      if (allowed && values.some((v) => !allowed.has(v as string))) return FAIL
      return values
    }
  }
}
