import type {
  APIApplicationCommandSubcommandOption,
  APIMessage,
  APIMessageApplicationCommandInteraction,
  APIUserApplicationCommandInteraction,
  RESTPostAPIApplicationCommandsJSONBody,
} from "discord-api-types/v10"
import type { Context } from "./context.ts"
import { type ChatInputInteraction, CommandType } from "./discord.ts"
import { AppConfigError } from "./errors.ts"
import { checkLength, checkName, checkOptions, OptionType, optionDefinitions, type Options, type OptionValues, type ResolvedUser } from "./options.ts"
import type { Output } from "./response.ts"
import type { Env, MaybePromise } from "./types.ts"

export type CommandContext<E extends Env = Env> = Context<E, ChatInputInteraction>
export type UserCommandContext<E extends Env = Env> = Context<E, APIUserApplicationCommandInteraction>
export type MessageCommandContext<E extends Env = Env> = Context<E, APIMessageApplicationCommandInteraction>

/** Where a Command can be used. */
export type InteractionContext = "guild" | "botDm" | "privateChannel"
/** How the app must be installed for a Command to be available. */
export type IntegrationType = "guildInstall" | "userInstall"

/** Settings only a top-level Command (not a subcommand) has. */
export interface TopLevelConfig {
  /** Default: wherever the app is installed. */
  contexts?: readonly InteractionContext[]
  integrationTypes?: readonly IntegrationType[]
  /** Named Sync destination, resolved to guilds at Sync time; omit for a global Command. */
  scope?: string
  /** Permissions members need by default (bit set as bigint or decimal string); `"0"` hides it from all but admins. */
  defaultMemberPermissions?: bigint | string | null
  /** Age-restricted. */
  nsfw?: boolean
}

const TOP_LEVEL_KEYS = ["contexts", "integrationTypes", "scope", "defaultMemberPermissions", "nsfw"] as const

export interface CommandConfig<E extends Env, O extends Options> extends TopLevelConfig {
  /** 1-32 lowercase characters: letters, digits, `-`, `_`, `'`. */
  name: string
  /** 1-100 characters. */
  description: string
  /** Keyed by Option name. Required Options are sent before optional ones automatically. */
  options?: O
  handler(c: CommandContext<E>, options: OptionValues<O>): MaybePromise<Output>
}

/** A chat input (slash) Command, top-level or a subcommand of a Group. */
export interface Command<E extends Env = Env, O extends Options = Options> {
  readonly kind: "command"
  readonly type: typeof CommandType.ChatInput
  readonly name: string
  readonly description: string
  readonly options: O
  readonly topLevel: TopLevelConfig
  handler(c: CommandContext<E>, options: OptionValues<O>): MaybePromise<Output>
  /** The Command Definition Sync publishes. */
  definition(): RESTPostAPIApplicationCommandsJSONBody
}

export interface GroupConfig<E extends Env> extends TopLevelConfig {
  name: string
  description: string
  /** Commands and, one level deep, Groups of Commands. */
  subcommands: readonly (Command<E, any> | Group<E>)[]
}

/** A Command that only contains subcommands (or nested Groups); not invokable itself. */
export interface Group<E extends Env = Env> {
  readonly kind: "group"
  readonly type: typeof CommandType.ChatInput
  readonly name: string
  readonly description: string
  readonly subcommands: readonly (Command<E, any> | Group<E>)[]
  readonly topLevel: TopLevelConfig
  definition(): RESTPostAPIApplicationCommandsJSONBody
}

export interface UserCommandConfig<E extends Env> extends TopLevelConfig {
  /** 1-32 characters, shown in the user context menu as is. */
  name: string
  handler(c: UserCommandContext<E>, target: ResolvedUser): MaybePromise<Output>
}

/** A user context menu Command (right-click a user → Apps). */
export interface UserCommand<E extends Env = Env> {
  readonly kind: "user"
  readonly type: typeof CommandType.User
  readonly name: string
  readonly topLevel: TopLevelConfig
  handler(c: UserCommandContext<E>, target: ResolvedUser): MaybePromise<Output>
  definition(): RESTPostAPIApplicationCommandsJSONBody
}

export interface MessageCommandConfig<E extends Env> extends TopLevelConfig {
  /** 1-32 characters, shown in the message context menu as is. */
  name: string
  handler(c: MessageCommandContext<E>, target: APIMessage): MaybePromise<Output>
}

/** A message context menu Command (right-click a message → Apps). */
export interface MessageCommand<E extends Env = Env> {
  readonly kind: "message"
  readonly type: typeof CommandType.Message
  readonly name: string
  readonly topLevel: TopLevelConfig
  handler(c: MessageCommandContext<E>, target: APIMessage): MaybePromise<Output>
  definition(): RESTPostAPIApplicationCommandsJSONBody
}

/** Anything listed with `app.command(..)`. */
export type AnyCommand<E extends Env = Env> = Command<E, any> | Group<E> | UserCommand<E> | MessageCommand<E>

/** Defines a chat input Command; its handler's Option values are inferred from `options`. */
export function command<O extends Options = {}, E extends Env = Env>(config: CommandConfig<E, O>): Command<E, O> {
  const { name, description, options = {} as O, handler } = config
  const path = `Command "/${name}"`
  checkName("Command name", name)
  checkLength(`${path} description`, description, 1, 100)
  checkOptions(path, options)
  const topLevel = pickTopLevel(config)
  return {
    kind: "command",
    type: CommandType.ChatInput,
    name,
    description,
    options,
    topLevel,
    handler,
    definition: () =>
      ({ type: CommandType.ChatInput, name, description, ...withOptions(optionDefinitions(options)), ...topLevelDefinition(topLevel) }) as RESTPostAPIApplicationCommandsJSONBody,
  }
}

/** Defines a Group: `/admin ban`, `/admin role add`. */
export function group<E extends Env = Env>(config: GroupConfig<E>): Group<E> {
  const { name, description, subcommands } = config
  const path = `Group "/${name}"`
  checkName("Group name", name)
  checkLength(`${path} description`, description, 1, 100)
  if (subcommands.length === 0 || subcommands.length > 25) throw new AppConfigError(`${path}: needs 1-25 subcommands, it has ${subcommands.length}`)
  const seen = new Set<string>()
  for (const sub of subcommands) {
    if (seen.has(sub.name)) throw new AppConfigError(`${path}: subcommand "${sub.name}" is listed twice`)
    seen.add(sub.name)
    if (Object.keys(sub.topLevel).length > 0) {
      throw new AppConfigError(`${path} > "${sub.name}": ${Object.keys(sub.topLevel).join(", ")} can only be set on top-level Commands`)
    }
    if (sub.kind === "group") {
      const deep = sub.subcommands.find((s) => s.kind === "group")
      if (deep) throw new AppConfigError(`${path} > "${sub.name}" > "${deep.name}": Groups nest only one level deep`)
    }
  }
  const topLevel = pickTopLevel(config)
  return {
    kind: "group",
    type: CommandType.ChatInput,
    name,
    description,
    subcommands,
    topLevel,
    definition: () =>
      ({
        type: CommandType.ChatInput,
        name,
        description,
        options: subcommands.map((sub) =>
          sub.kind === "group"
            ? { type: OptionType.SubcommandGroup, name: sub.name, description: sub.description, options: sub.subcommands.map((s) => subcommandDefinition(s as Command<E>)) }
            : subcommandDefinition(sub),
        ),
        ...topLevelDefinition(topLevel),
      }) as RESTPostAPIApplicationCommandsJSONBody,
  }
}

/** Defines a user context menu Command; the handler gets the clicked user. */
export function userCommand<E extends Env = Env>(config: UserCommandConfig<E>): UserCommand<E> {
  const { name, handler } = config
  checkLength("User Command name", name, 1, 32)
  const topLevel = pickTopLevel(config)
  return {
    kind: "user",
    type: CommandType.User,
    name,
    topLevel,
    handler,
    definition: () => ({ type: CommandType.User, name, ...topLevelDefinition(topLevel) }) as RESTPostAPIApplicationCommandsJSONBody,
  }
}

/** Defines a message context menu Command; the handler gets the clicked message. */
export function messageCommand<E extends Env = Env>(config: MessageCommandConfig<E>): MessageCommand<E> {
  const { name, handler } = config
  checkLength("Message Command name", name, 1, 32)
  const topLevel = pickTopLevel(config)
  return {
    kind: "message",
    type: CommandType.Message,
    name,
    topLevel,
    handler,
    definition: () => ({ type: CommandType.Message, name, ...topLevelDefinition(topLevel) }) as RESTPostAPIApplicationCommandsJSONBody,
  }
}

function subcommandDefinition(command: Command<any>): APIApplicationCommandSubcommandOption {
  return {
    type: OptionType.Subcommand,
    name: command.name,
    description: command.description,
    ...withOptions(optionDefinitions(command.options)),
  } as APIApplicationCommandSubcommandOption
}

function withOptions<T>(options: T[]): { options?: T[] } {
  return options.length > 0 ? { options } : {}
}

function pickTopLevel(config: TopLevelConfig): TopLevelConfig {
  const out: Record<string, unknown> = {}
  for (const key of TOP_LEVEL_KEYS) if (config[key] !== undefined) out[key] = config[key]
  return out as TopLevelConfig
}

const CONTEXTS: Record<InteractionContext, number> = { guild: 0, botDm: 1, privateChannel: 2 }
const INTEGRATION_TYPES: Record<IntegrationType, number> = { guildInstall: 0, userInstall: 1 }

function topLevelDefinition(config: TopLevelConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (config.contexts) out.contexts = config.contexts.map((c) => CONTEXTS[c])
  if (config.integrationTypes) out.integration_types = config.integrationTypes.map((t) => INTEGRATION_TYPES[t])
  if (config.defaultMemberPermissions !== undefined) {
    out.default_member_permissions = config.defaultMemberPermissions === null ? null : String(config.defaultMemberPermissions)
  }
  if (config.nsfw !== undefined) out.nsfw = config.nsfw
  return out
}
