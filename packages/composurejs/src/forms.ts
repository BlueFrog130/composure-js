// Forms (ADR 0028): a modal's inputs defined once, from which the modal is rendered and its
// submitted values typed and parsed. Each Field becomes a <Label> around one input; a Field that
// parses its value (numbers) or resolves it (users, roles, channels) says so in its input's
// custom_id, so a modal still open across a deploy decodes the same way.
import { joinFields } from "./codec.ts"
import { AppConfigError } from "./errors.ts"
import { createNode, type ElementNode } from "./jsx/node.ts"
import type { Attachment, Choices, PartialChannel, ResolvedUser, Role } from "./options.ts"

/** What one Field renders and how its value comes back. */
export interface FieldSpec {
  readonly kind: "text" | "integer" | "number" | "radio" | "select" | "checkboxes" | "checkbox" | "user" | "role" | "mentionable" | "channel" | "files"
  /** The field's title; 1-45 characters. */
  readonly label: string
  /** Under the title; max 100 characters. */
  readonly description?: string | undefined
  readonly required: boolean
  readonly choices?: Choices<string> | undefined
  readonly placeholder?: string | undefined
  readonly paragraph?: boolean | undefined
  readonly minLength?: number | undefined
  readonly maxLength?: number | undefined
  readonly min?: number | undefined
  readonly max?: number | undefined
  readonly channelTypes?: readonly number[] | undefined
  readonly fileTypes?: readonly string[] | undefined
}

/** A Field: `T` is the value `onSubmit` receives, `P` what `values` prefills it with. */
export class Field<T, P = T> {
  declare readonly __value: T
  declare readonly __prefill: P

  constructor(readonly spec: FieldSpec) {}

  /** The user may leave it empty: `undefined`, or an empty list for Fields that take several. */
  optional(): Field<T extends readonly unknown[] ? T : T | undefined, P> {
    if (this.spec.kind === "checkbox") throw new AppConfigError("A checkbox Field is never required; it is false when unchecked")
    return new Field({ ...this.spec, required: false })
  }
}

type AnyField = Field<any, any>
type Fields = Record<string, AnyField>

/** The values `onSubmit` receives from a Form's Fields. */
export type FormValues<F extends Fields> = { -readonly [K in keyof F]: F[K]["__value"] }
/** What `values` on `<Modal form>` prefills, by Field. */
export type FormPrefill<F extends Fields> = { -readonly [K in keyof F]?: F[K]["__prefill"] | undefined }

/** Holds the Form's renderer, so render reaches it without bundling Forms for bots that use none. */
export const FORM = Symbol.for("composurejs.form")

/** A typed definition of a modal's inputs, made with {@link form}. */
export interface Form<V = Record<string, unknown>, P = Partial<V>> {
  /** Renders the Form's Labels, prefilled. */
  readonly [FORM]: (values: Record<string, unknown>) => ElementNode[]
  readonly fields: Readonly<Record<string, FieldSpec>>
  /** Types only. */
  readonly __values?: V
  /** Types only. */
  readonly __prefill?: P
}

export function isForm(value: unknown): value is Form {
  return typeof value === "object" && value !== null && typeof (value as Partial<Form>)[FORM] === "function"
}

/** Field keys are input custom_ids: letters, digits, `_` and `-`. */
const KEY = /^[A-Za-z][\w-]{0,39}$/

/**
 * A Form: `<Modal title=".." form={feedback} onSubmit={(c, v) => ..}>` renders a `<Label>` per Field
 * and types `v` from them. Up to 5 Fields (with any `<Text>` children of the modal).
 */
export function form<const F extends Fields>(fields: F): Form<FormValues<F>, FormPrefill<F>> {
  const specs: Record<string, FieldSpec> = {}
  for (const [key, f] of Object.entries(fields)) {
    if (!KEY.test(key)) throw new AppConfigError(`Form field "${key}": keys are 1-40 letters, digits, "_" or "-", starting with a letter`)
    if (!(f instanceof Field)) throw new AppConfigError(`Form field "${key}" is not a Field; make it with field.text(..), field.radio(..), ...`)
    specs[key] = f.spec
  }
  const made: Form<FormValues<F>, FormPrefill<F>> = { [FORM]: (values) => formLabels(made, values), fields: specs }
  return made
}

interface Labeled {
  /** The field's title; 1-45 characters. */
  label: string
  /** Under the title; max 100 characters. */
  description?: string
}

const make = <T, P = T>(kind: FieldSpec["kind"], options: Labeled & Omit<Partial<FieldSpec>, "kind" | "required">) => new Field<T, P>({ ...options, kind, required: true })

/** Field builders for {@link form}. Every Field is required unless `.optional()`. */
export const field = {
  /** Text: single-line, or `paragraph`. */
  text: (options: Labeled & { paragraph?: boolean; minLength?: number; maxLength?: number; placeholder?: string }) => make<string>("text", options),
  /** A whole number typed as text, checked against `min` / `max` on submit. */
  integer: (options: Labeled & { min?: number; max?: number; placeholder?: string }) => make<number>("integer", options),
  /** A number typed as text, checked against `min` / `max` on submit. */
  number: (options: Labeled & { min?: number; max?: number; placeholder?: string }) => make<number>("number", options),
  /** Pick one of `choices`. */
  radio: <const V extends string>(choices: Choices<V>, options: Labeled) => make<V>("radio", { ...options, choices }),
  /** A select of `choices`; `min` / `max` selections (default 1). */
  select: <const V extends string>(choices: Choices<V>, options: Labeled & { min?: number; max?: number; placeholder?: string }) => make<V[]>("select", { ...options, choices }),
  /** Pick any of `choices` (up to 10). */
  checkboxes: <const V extends string>(choices: Choices<V>, options: Labeled & { min?: number; max?: number }) => make<V[]>("checkboxes", { ...options, choices }),
  /** One yes/no box: `true` when checked. */
  checkbox: (options: Labeled) => make<boolean>("checkbox", options),
  /** Users of the server, resolved; prefilled by id. */
  user: (options: Labeled & { min?: number; max?: number; placeholder?: string }) => make<ResolvedUser[], string[]>("user", options),
  /** Roles of the server, resolved; prefilled by id. */
  role: (options: Labeled & { min?: number; max?: number; placeholder?: string }) => make<Role[], string[]>("role", options),
  /** Users and roles, resolved; prefilled by `{ id, type }`. */
  mentionable: (options: Labeled & { min?: number; max?: number; placeholder?: string }) =>
    make<(ResolvedUser | Role)[], { id: string; type: "user" | "role" }[]>("mentionable", options),
  /** Channels, resolved; `types` restricts which (`ChannelType` numbers). Prefilled by id. */
  channel: (options: Labeled & { min?: number; max?: number; placeholder?: string; types?: readonly number[] }) => {
    const { types, ...rest } = options
    return make<PartialChannel[], string[]>("channel", { ...rest, channelTypes: types })
  },
  /** Uploaded files; `types` like `["image", ".pdf"]`. Cannot be prefilled. */
  files: (options: Labeled & { min?: number; max?: number; types?: readonly string[] }) => {
    const { types, ...rest } = options
    return make<Attachment[], never>("files", { ...rest, fileTypes: types })
  },
}

/** Marks an input's custom_id with how its value is decoded: `name~kind:args`. Read by `modalValues`. */
export function marked(name: string, spec: FieldSpec): string {
  switch (spec.kind) {
    case "integer":
    case "number":
      return `${name}~${joinFields([spec.kind === "integer" ? "n" : "d", spec.min === undefined ? "" : String(spec.min), spec.max === undefined ? "" : String(spec.max), spec.label])}`
    case "user":
    case "role":
    case "mentionable":
    case "channel":
      return `${name}~r`
  }
  return name
}

/** The `<Label>`s a Form renders, prefilled with `values`. */
export function formLabels(form: Form, values: Record<string, unknown> = {}): ElementNode[] {
  return Object.entries(form.fields).map(([name, spec]) => {
    const prefill = values[name]
    const required = spec.required ? {} : { required: false }
    const options = (selected: (value: string) => boolean) =>
      (spec.choices ?? []).map(({ name: label, value }) => createNode("Option", { value, label, ...(selected(value) && { default: true }) }))
    const listed = (value: string) => Array.isArray(prefill) && prefill.includes(value)
    const counts = { ...(spec.min !== undefined && { minValues: spec.min }), ...(spec.max !== undefined && { maxValues: spec.max }) }
    const id = marked(name, spec)
    let input: ElementNode
    switch (spec.kind) {
      case "text":
        input = createNode("TextInput", {
          name: id,
          ...required,
          ...(spec.paragraph && { paragraph: true }),
          ...(spec.minLength !== undefined && { minLength: spec.minLength }),
          ...(spec.maxLength !== undefined && { maxLength: spec.maxLength }),
          ...(spec.placeholder !== undefined && { placeholder: spec.placeholder }),
          ...(typeof prefill === "string" && { value: prefill }),
        })
        break
      case "integer":
      case "number":
        input = createNode("TextInput", {
          name: id,
          ...required,
          maxLength: 32,
          ...(spec.placeholder !== undefined && { placeholder: spec.placeholder }),
          ...(typeof prefill === "number" && { value: String(prefill) }),
        })
        break
      case "radio":
        input = createNode("RadioGroup", { name: id, ...required, children: options((v) => v === prefill) })
        break
      case "select":
        input = createNode("StringSelect", {
          name: id,
          ...required,
          ...counts,
          ...(spec.placeholder !== undefined && { placeholder: spec.placeholder }),
          children: options(listed),
        })
        break
      case "checkboxes":
        input = createNode("CheckboxGroup", { name: id, ...required, ...counts, children: options(listed) })
        break
      case "checkbox":
        input = createNode("Checkbox", { name: id, ...(prefill === true && { default: true }) })
        break
      case "files":
        input = createNode("FileUpload", { name: id, ...required, ...counts, ...(spec.fileTypes && { fileTypes: [...spec.fileTypes] }) })
        break
      default: {
        const tag = { user: "UserSelect", role: "RoleSelect", mentionable: "MentionableSelect", channel: "ChannelSelect" }[spec.kind]
        input = createNode(tag, {
          name: id,
          ...required,
          ...counts,
          ...(spec.placeholder !== undefined && { placeholder: spec.placeholder }),
          ...(Array.isArray(prefill) && { defaultValues: prefill }),
          ...(spec.channelTypes && { channelTypes: [...spec.channelTypes] }),
        })
      }
    }
    return createNode("Label", { text: spec.label, ...(spec.description !== undefined && { description: spec.description }), children: input })
  })
}
