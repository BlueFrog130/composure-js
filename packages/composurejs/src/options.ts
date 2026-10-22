// Options: typed inputs of a Command. Each builder carries its resolved value type, so a
// Command's handler arguments are inferred from its definition.
import type {
  APIApplicationCommandAutocompleteInteraction,
  APIApplicationCommandBasicOption,
  APIApplicationCommandInteractionDataBasicOption,
  APIAttachment,
  APIInteractionDataResolved,
  APIInteractionDataResolvedChannel,
  APIInteractionDataResolvedGuildMember,
  APIRole,
} from "discord-api-types/v10"
import type { Context } from "./context.ts"
import type { User } from "./discord.ts"
import { AppConfigError, InvalidOptionsError } from "./errors.ts"
import type { Env, MaybePromise } from "./types.ts"

export const OptionType = {
  Subcommand: 1,
  SubcommandGroup: 2,
  String: 3,
  Integer: 4,
  Boolean: 5,
  User: 6,
  Channel: 7,
  Role: 8,
  Mentionable: 9,
  Number: 10,
  Attachment: 11,
} as const

export type ResolvedMember = APIInteractionDataResolvedGuildMember
export type PartialChannel = APIInteractionDataResolvedChannel
export type Role = APIRole
export type Attachment = APIAttachment

/** A User Option's value: the user, their member data when invoked in a guild, and the name to show. */
export interface ResolvedUser extends User {
  member: ResolvedMember | undefined
  /** Server nickname, else global display name, else username. */
  displayName: string
}

/** One of a fixed set of values; `name` is what the user sees. */
export interface Choice<V extends string | number = string | number> {
  name: string
  value: V
}

export type Choices<V extends string | number = string | number> = readonly Choice<V>[]

/**
 * Defines Choices once, to share between Options and modal fields. Takes `{ value: "Name" }`
 * for strings, or a list of `{ name, value }` for any value type.
 */
export function defineChoices<const C extends Record<string, string>>(choices: C): Choices<keyof C & string>
export function defineChoices<const C extends readonly Choice[]>(choices: C): C
export function defineChoices(choices: Record<string, string> | Choices): Choices {
  return Array.isArray(choices) ? choices : Object.entries(choices).map(([value, name]) => ({ name, value }))
}

/** The value type a `Choices` list allows. */
export type ChoiceValue<C> = C extends Choices<infer V> ? V : never

export type AutocompleteContext<E extends Env = Env> = Context<E, APIApplicationCommandAutocompleteInteraction>

/**
 * Suggests Choices while the user types. `input` is the focused Option's partial text; `options`
 * holds the raw values of the others filled in so far. At most 25 results are sent.
 */
export type AutocompleteHandler<T = string | number, E extends Env = any> = (
  c: AutocompleteContext<E>,
  input: string,
  options: Readonly<Record<string, string | number | boolean | undefined>>,
) => MaybePromise<readonly (Choice<T & (string | number)> | (T & (string | number)))[]>

/** Everything about one Option except its name (the key it is listed under). */
export interface OptionSpec {
  readonly type: number
  readonly description: string
  readonly required: boolean
  readonly choices?: Choices | undefined
  readonly autocomplete?: AutocompleteHandler<any> | undefined
  readonly min?: number | undefined
  readonly max?: number | undefined
  readonly minLength?: number | undefined
  readonly maxLength?: number | undefined
  readonly channelTypes?: readonly number[] | undefined
}

/** An Option builder. `T` is the value the handler receives, `R` whether it is required. */
export class OptionBuilder<T, R extends boolean = true> {
  declare readonly __value: T
  declare readonly __required: R

  constructor(readonly spec: OptionSpec) {}

  /** The user may leave it out; the handler then gets `undefined`. Required Options are sent first. */
  optional(): OptionBuilder<T, false> {
    return new OptionBuilder({ ...this.spec, required: false })
  }

  /** Restricts the value to `choices` (at most 25). Not with `autocomplete`. */
  choices<const V extends T & (string | number)>(this: OptionBuilder<string, R> | OptionBuilder<number, R>, choices: Choices<V>): OptionBuilder<V, R> {
    if (this.spec.autocomplete) throw new AppConfigError("An Option cannot have both choices and autocomplete")
    return new OptionBuilder({ ...this.spec, choices })
  }

  /** Suggests values while the user types. Not with `choices`. */
  autocomplete(this: OptionBuilder<string, R> | OptionBuilder<number, R>, handler: AutocompleteHandler<T>): OptionBuilder<T, R> {
    if (this.spec.choices) throw new AppConfigError("An Option cannot have both choices and autocomplete")
    return new OptionBuilder({ ...this.spec, autocomplete: handler })
  }
}

export type AnyOption = OptionBuilder<any, boolean>
export type Options = Record<string, AnyOption>

type Simplify<T> = { [K in keyof T]: T[K] } & {}

/** The handler's second argument for Options `O`. */
export type OptionValues<O extends Options> = Simplify<
  { [K in keyof O as O[K] extends OptionBuilder<any, true> ? K : never]: O[K]["__value"] } & {
    [K in keyof O as O[K] extends OptionBuilder<any, true> ? never : K]?: O[K]["__value"]
  }
>

const make = <T>(type: number, description: string, extra: Partial<OptionSpec> = {}) => {
  checkLength("Option description", description, 1, 100)
  return new OptionBuilder<T>({ type, description, required: true, ...extra })
}

/** Option builders: `option.string("Flavor")`, `option.integer("How many", { min: 1 }).optional()`, ... */
export const option = {
  string: (description: string, limits: { minLength?: number; maxLength?: number } = {}) => make<string>(OptionType.String, description, limits),
  integer: (description: string, limits: { min?: number; max?: number } = {}) => make<number>(OptionType.Integer, description, limits),
  number: (description: string, limits: { min?: number; max?: number } = {}) => make<number>(OptionType.Number, description, limits),
  boolean: (description: string) => make<boolean>(OptionType.Boolean, description),
  user: (description: string) => make<ResolvedUser>(OptionType.User, description),
  /** `types` restricts which channel types can be picked (`ChannelType` numbers). */
  channel: (description: string, { types }: { types?: readonly number[] } = {}) => make<PartialChannel>(OptionType.Channel, description, { channelTypes: types }),
  role: (description: string) => make<Role>(OptionType.Role, description),
  mentionable: (description: string) => make<ResolvedUser | Role>(OptionType.Mentionable, description),
  attachment: (description: string) => make<Attachment>(OptionType.Attachment, description),
}

export const NAME = /^[-_'\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u

export function checkName(what: string, name: string): void {
  if (!NAME.test(name) || name !== name.toLowerCase()) {
    throw new AppConfigError(`${what} "${name}" must be 1-32 lowercase letters, digits, "-", "_" or "'"`)
  }
}

export function checkLength(what: string, value: string, min: number, max: number): void {
  if (value.length < min || value.length > max) {
    throw new AppConfigError(`${what} must be ${min}-${max} characters, "${value.slice(0, 40)}" has ${value.length}`)
  }
}

/** Checks Options against Discord's rules, naming the offending path. */
export function checkOptions(path: string, options: Options): void {
  const entries = Object.entries(options)
  if (entries.length > 25) throw new AppConfigError(`${path}: at most 25 Options, it has ${entries.length}`)
  for (const [name, { spec }] of entries) {
    const at = `${path} option "${name}"`
    checkName(at, name)
    if (spec.choices) {
      if (spec.choices.length > 25) throw new AppConfigError(`${at}: at most 25 choices, it has ${spec.choices.length}`)
      for (const choice of spec.choices) {
        checkLength(`${at} choice name`, choice.name, 1, 100)
        if (typeof choice.value === "string") checkLength(`${at} choice value`, choice.value, 1, 100)
        else if (spec.type === OptionType.String) throw new AppConfigError(`${at}: choice values of a string Option must be strings`)
      }
    }
    if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) throw new AppConfigError(`${at}: min is greater than max`)
    if (spec.minLength !== undefined && (spec.minLength < 0 || spec.minLength > 6000)) throw new AppConfigError(`${at}: minLength must be 0-6000`)
    if (spec.maxLength !== undefined && (spec.maxLength < 1 || spec.maxLength > 6000)) throw new AppConfigError(`${at}: maxLength must be 1-6000`)
  }
}

/** The Options' definitions, required ones first (Discord's rule, applied rather than checked). */
export function optionDefinitions(options: Options): APIApplicationCommandBasicOption[] {
  const entries = Object.entries(options)
  const sorted = [...entries.filter(([, o]) => o.spec.required), ...entries.filter(([, o]) => !o.spec.required)]
  return sorted.map(([name, { spec }]) => {
    const json: Record<string, unknown> = { type: spec.type, name, description: spec.description }
    if (spec.required) json.required = true
    if (spec.choices) json.choices = spec.choices.map(({ name, value }) => ({ name, value }))
    if (spec.autocomplete) json.autocomplete = true
    if (spec.min !== undefined) json.min_value = spec.min
    if (spec.max !== undefined) json.max_value = spec.max
    if (spec.minLength !== undefined) json.min_length = spec.minLength
    if (spec.maxLength !== undefined) json.max_length = spec.maxLength
    if (spec.channelTypes) json.channel_types = [...spec.channelTypes]
    return json as unknown as APIApplicationCommandBasicOption
  })
}

/** A user from `resolved`, with member data and display name. */
export function resolveUser(id: string, resolved: APIInteractionDataResolved | undefined): ResolvedUser | undefined {
  const user = resolved?.users?.[id]
  if (!user) return undefined
  const member = resolved?.members?.[id]
  return { ...user, member, displayName: member?.nick ?? user.global_name ?? user.username }
}

/** The handler's values from the Interaction's raw Options; throws {@link InvalidOptionsError} when they do not match. */
export function resolveOptions(
  options: Options,
  raw: readonly APIApplicationCommandInteractionDataBasicOption[] | undefined,
  resolved: APIInteractionDataResolved | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const given = new Map((raw ?? []).map((o) => [o.name, o]))
  for (const [name, { spec }] of Object.entries(options)) {
    const input = given.get(name)
    if (!input || !("value" in input)) {
      if (spec.required) throw new InvalidOptionsError(`Required Option "${name}" is missing`)
      continue
    }
    const value = resolveValue(spec.type, input.value, resolved)
    if (value === undefined) throw new InvalidOptionsError(`Option "${name}" does not match its definition`)
    out[name] = value
  }
  return out
}

function resolveValue(type: number, value: unknown, resolved: APIInteractionDataResolved | undefined): unknown {
  switch (type) {
    case OptionType.String:
      return typeof value === "string" ? value : undefined
    case OptionType.Integer:
    case OptionType.Number:
      return typeof value === "number" ? value : undefined
    case OptionType.Boolean:
      return typeof value === "boolean" ? value : undefined
  }
  if (typeof value !== "string") return undefined
  switch (type) {
    case OptionType.User:
      return resolveUser(value, resolved)
    case OptionType.Channel:
      return resolved?.channels?.[value]
    case OptionType.Role:
      return resolved?.roles?.[value]
    case OptionType.Mentionable:
      return resolveUser(value, resolved) ?? resolved?.roles?.[value]
    case OptionType.Attachment:
      return resolved?.attachments?.[value]
  }
  return undefined
}
