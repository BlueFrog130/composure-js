import type {
  APIApplicationCommandSubcommandOption,
  APIMessage,
  APIMessageApplicationCommandInteraction,
  APIUserApplicationCommandInteraction,
  Locale as DiscordLocale,
  RESTPostAPIApplicationCommandsJSONBody,
} from "discord-api-types/v10";
import type { Context } from "./context.ts";
import { type ChatInputInteraction, CommandType } from "./discord.ts";
import { AppConfigError } from "./errors.ts";
import {
  checkLength,
  checkName,
  checkOptions,
  type LocaleMap,
  type OptionLocales,
  OptionType,
  optionDefinitions,
  type Options,
  type OptionValues,
  type ResolvedUser,
} from "./options.ts";
import type { Output } from "./response.ts";
import type { Env, MaybePromise } from "./types.ts";

export type CommandContext<E extends Env = Env> = Context<E, ChatInputInteraction>;
export type UserCommandContext<E extends Env = Env> = Context<E, APIUserApplicationCommandInteraction>;
export type MessageCommandContext<E extends Env = Env> = Context<E, APIMessageApplicationCommandInteraction>;

/** Where a Command can be used. */
export type InteractionContext = "guild" | "botDm" | "privateChannel";
/** How the app must be installed for a Command to be available. */
export type IntegrationType = "guildInstall" | "userInstall";

/**
 * Auto Defer for one Command (ADR 0027): `false` turns it off; `"ephemeral"` makes the loading
 * state private, for Commands whose answers are.
 */
export type AutoDeferSetting = false | "ephemeral";

/** Settings only a top-level Command (not a subcommand) has. */
export interface TopLevelConfig {
  /** Default: wherever the app is installed. */
  contexts?: readonly InteractionContext[];
  integrationTypes?: readonly IntegrationType[];
  /** Named Sync destination, resolved to guilds at Sync time; omit for a global Command. */
  scope?: string;
  /** Permissions members need by default (bit set as bigint or decimal string); `"0"` hides it from all but admins. */
  defaultMemberPermissions?: bigint | string | null;
  /** Age-restricted. */
  nsfw?: boolean;
}

const LOCALES: unique symbol = Symbol("composurejs.locales");

const TOP_LEVEL_KEYS = ["contexts", "integrationTypes", "scope", "defaultMemberPermissions", "nsfw"] as const;

/** A locale Discord's clients use: `"fr"`, `"en-GB"`, `"pt-BR"`, ... */
export type Locale = `${DiscordLocale}`;

/** One Option's Localizations: its name and description, and Choice names keyed by Choice value. */
export interface OptionLocalization {
  name?: string;
  description?: string;
  choices?: Readonly<Record<string, string>>;
}

/** A Command's Localizations in one locale. Each name follows the same rules as the original. */
export interface CommandLocalization<O extends Options = Options> {
  name?: string;
  description?: string;
  options?: { readonly [K in keyof O]?: OptionLocalization };
}

/** Localizations by locale (Discord shows them to users of that locale; Sync publishes them). */
export type Localizations<T> = { readonly [L in Locale]?: T };

export interface CommandConfig<E extends Env, O extends Options> extends TopLevelConfig {
  /** Auto Defer for this Command (and, on a Group, its subcommands unless they set it). Default: the App's. */
  autoDefer?: AutoDeferSetting;
  /** 1-32 lowercase characters: letters, digits, `-`, `_`, `'`. */
  name: string;
  /** 1-100 characters. */
  description: string;
  /** Keyed by Option name. Required Options are sent before optional ones automatically. */
  options?: O;
  /** Names, descriptions, Option names and Choice names per locale: `{ fr: { name: "saluer", .. } }`. */
  localizations?: Localizations<CommandLocalization<NoInfer<O>>>;
  handler(c: CommandContext<E>, options: OptionValues<O>): MaybePromise<Output>;
}

/** A chat input (slash) Command, top-level or a subcommand of a Group. */
export interface Command<E extends Env = Env, O extends Options = Options> {
  readonly autoDefer: AutoDeferSetting | undefined;
  readonly kind: "command";
  readonly type: typeof CommandType.ChatInput;
  readonly name: string;
  readonly description: string;
  readonly options: O;
  readonly topLevel: TopLevelConfig;
  handler(c: CommandContext<E>, options: OptionValues<O>): MaybePromise<Output>;
  /** The Command Definition Sync publishes. */
  definition(): RESTPostAPIApplicationCommandsJSONBody;
  /** @internal */
  readonly [LOCALES]: Locales;
}

export interface GroupConfig<E extends Env> extends TopLevelConfig {
  /** Auto Defer for this Command (and, on a Group, its subcommands unless they set it). Default: the App's. */
  autoDefer?: AutoDeferSetting;
  name: string;
  description: string;
  /** The Group's own name and description per locale; each subcommand carries its own. */
  localizations?: Localizations<{ name?: string; description?: string }>;
  /** Commands and, one level deep, Groups of Commands. */
  subcommands: readonly (Command<E, any> | Group<E>)[];
}

/** A Command that only contains subcommands (or nested Groups); not invokable itself. */
export interface Group<E extends Env = Env> {
  readonly autoDefer: AutoDeferSetting | undefined;
  readonly kind: "group";
  readonly type: typeof CommandType.ChatInput;
  readonly name: string;
  readonly description: string;
  readonly subcommands: readonly (Command<E, any> | Group<E>)[];
  readonly topLevel: TopLevelConfig;
  definition(): RESTPostAPIApplicationCommandsJSONBody;
  /** @internal */
  readonly [LOCALES]: Locales;
}

export interface UserCommandConfig<E extends Env> extends TopLevelConfig {
  /** Auto Defer for this Command (and, on a Group, its subcommands unless they set it). Default: the App's. */
  autoDefer?: AutoDeferSetting;
  /** 1-32 characters, shown in the user context menu as is. */
  name: string;
  /** The name per locale. */
  localizations?: Localizations<{ name?: string }>;
  handler(c: UserCommandContext<E>, target: ResolvedUser): MaybePromise<Output>;
}

/** A user context menu Command (right-click a user → Apps). */
export interface UserCommand<E extends Env = Env> {
  readonly autoDefer: AutoDeferSetting | undefined;
  readonly kind: "user";
  readonly type: typeof CommandType.User;
  readonly name: string;
  readonly topLevel: TopLevelConfig;
  handler(c: UserCommandContext<E>, target: ResolvedUser): MaybePromise<Output>;
  definition(): RESTPostAPIApplicationCommandsJSONBody;
}

export interface MessageCommandConfig<E extends Env> extends TopLevelConfig {
  /** Auto Defer for this Command (and, on a Group, its subcommands unless they set it). Default: the App's. */
  autoDefer?: AutoDeferSetting;
  /** 1-32 characters, shown in the message context menu as is. */
  name: string;
  /** The name per locale. */
  localizations?: Localizations<{ name?: string }>;
  handler(c: MessageCommandContext<E>, target: APIMessage): MaybePromise<Output>;
}

/** A message context menu Command (right-click a message → Apps). */
export interface MessageCommand<E extends Env = Env> {
  readonly autoDefer: AutoDeferSetting | undefined;
  readonly kind: "message";
  readonly type: typeof CommandType.Message;
  readonly name: string;
  readonly topLevel: TopLevelConfig;
  handler(c: MessageCommandContext<E>, target: APIMessage): MaybePromise<Output>;
  definition(): RESTPostAPIApplicationCommandsJSONBody;
}

/** Anything listed with `app.command(..)`. */
export type AnyCommand<E extends Env = Env> = Command<E, any> | Group<E> | UserCommand<E> | MessageCommand<E>;

/** Defines a chat input Command; its handler's Option values are inferred from `options`. */
export function command<O extends Options = {}, E extends Env = Env>(config: CommandConfig<E, O>): Command<E, O> {
  const { name, description, options = {} as O, handler } = config;
  const path = `Command "/${name}"`;
  checkName("Command name", name);
  checkLength(`${path} description`, description, 1, 100);
  checkOptions(path, options);
  const topLevel = pickTopLevel(config);
  const locales = commandLocales(path, options, config.localizations);
  return {
    kind: "command",
    autoDefer: config.autoDefer,
    type: CommandType.ChatInput,
    name,
    description,
    options,
    topLevel,
    handler,
    definition: () =>
      ({
        type: CommandType.ChatInput,
        name,
        description,
        ...locales.own,
        ...withOptions(optionDefinitions(options, locales.options)),
        ...topLevelDefinition(topLevel),
      }) as RESTPostAPIApplicationCommandsJSONBody,
    [LOCALES]: locales,
  };
}

/** Defines a Group: `/admin ban`, `/admin role add`. */
export function group<E extends Env = Env>(config: GroupConfig<E>): Group<E> {
  const { name, description, subcommands } = config;
  const path = `Group "/${name}"`;
  checkName("Group name", name);
  checkLength(`${path} description`, description, 1, 100);
  if (subcommands.length === 0 || subcommands.length > 25) throw new AppConfigError(`${path}: needs 1-25 subcommands, it has ${subcommands.length}`);
  const seen = new Set<string>();
  for (const sub of subcommands) {
    if (seen.has(sub.name)) throw new AppConfigError(`${path}: subcommand "${sub.name}" is listed twice`);
    seen.add(sub.name);
    if (Object.keys(sub.topLevel).length > 0) {
      throw new AppConfigError(`${path} > "${sub.name}": ${Object.keys(sub.topLevel).join(", ")} can only be set on top-level Commands`);
    }
    if (sub.kind === "group") {
      const deep = sub.subcommands.find((s) => s.kind === "group");
      if (deep) throw new AppConfigError(`${path} > "${sub.name}" > "${deep.name}": Groups nest only one level deep`);
    }
  }
  const topLevel = pickTopLevel(config);
  const own = ownLocales(path, config.localizations, "chat");
  return {
    kind: "group",
    autoDefer: config.autoDefer,
    type: CommandType.ChatInput,
    name,
    description,
    subcommands,
    topLevel,
    [LOCALES]: { own, options: {} },
    definition: () =>
      ({
        type: CommandType.ChatInput,
        name,
        description,
        ...own,
        options: subcommands.map((sub) =>
          sub.kind === "group"
            ? {
                type: OptionType.SubcommandGroup,
                name: sub.name,
                description: sub.description,
                ...sub[LOCALES].own,
                options: sub.subcommands.map((s) => subcommandDefinition(s as Command<E>)),
              }
            : subcommandDefinition(sub),
        ),
        ...topLevelDefinition(topLevel),
      }) as RESTPostAPIApplicationCommandsJSONBody,
  };
}

/** Defines a user context menu Command; the handler gets the clicked user. */
export function userCommand<E extends Env = Env>(config: UserCommandConfig<E>): UserCommand<E> {
  const { name, handler } = config;
  checkLength("User Command name", name, 1, 32);
  const topLevel = pickTopLevel(config);
  const own = ownLocales(`User Command "${name}"`, config.localizations, "menu");
  return {
    kind: "user",
    autoDefer: config.autoDefer,
    type: CommandType.User,
    name,
    topLevel,
    handler,
    definition: () => ({ type: CommandType.User, name, ...own, ...topLevelDefinition(topLevel) }) as RESTPostAPIApplicationCommandsJSONBody,
  };
}

/** Defines a message context menu Command; the handler gets the clicked message. */
export function messageCommand<E extends Env = Env>(config: MessageCommandConfig<E>): MessageCommand<E> {
  const { name, handler } = config;
  checkLength("Message Command name", name, 1, 32);
  const topLevel = pickTopLevel(config);
  const own = ownLocales(`Message Command "${name}"`, config.localizations, "menu");
  return {
    kind: "message",
    autoDefer: config.autoDefer,
    type: CommandType.Message,
    name,
    topLevel,
    handler,
    definition: () => ({ type: CommandType.Message, name, ...own, ...topLevelDefinition(topLevel) }) as RESTPostAPIApplicationCommandsJSONBody,
  };
}

function subcommandDefinition(command: Command<any>): APIApplicationCommandSubcommandOption {
  const locales = command[LOCALES];
  return {
    type: OptionType.Subcommand,
    name: command.name,
    description: command.description,
    ...locales.own,
    ...withOptions(optionDefinitions(command.options, locales.options)),
  } as APIApplicationCommandSubcommandOption;
}

/** A definition's own `name_localizations` and `description_localizations`. */
interface OwnLocales {
  name_localizations?: LocaleMap;
  description_localizations?: LocaleMap;
}

/** @internal The checked Localizations of a Command or Group, as Discord takes them. */
export interface Locales {
  own: OwnLocales;
  options: Record<string, OptionLocales>;
}

/** Checks one definition's own Localizations by its rules (`chat`: lowercase names; `menu`: any 1-32 characters). */
function ownLocales(path: string, localizations: Localizations<{ name?: string; description?: string }> | undefined, kind: "chat" | "menu"): OwnLocales {
  const own: OwnLocales = {};
  for (const [locale, l] of Object.entries(localizations ?? {}) as [string, { name?: string; description?: string }][]) {
    if (l.name !== undefined) {
      if (kind === "chat") checkName(`${path} name (${locale})`, l.name);
      else checkLength(`${path} name (${locale})`, l.name, 1, 32);
      (own.name_localizations ??= {})[locale] = l.name;
    }
    if (l.description !== undefined) {
      if (kind === "menu") throw new AppConfigError(`${path} (${locale}): context menu Commands have no description`);
      checkLength(`${path} description (${locale})`, l.description, 1, 100);
      (own.description_localizations ??= {})[locale] = l.description;
    }
  }
  return own;
}

/** Checks a Command's Localizations against its Options, naming anything that does not match. */
function commandLocales(path: string, options: Options, localizations: Localizations<CommandLocalization> | undefined): Locales {
  const out: Locales = { own: ownLocales(path, localizations, "chat"), options: {} };
  for (const [locale, l] of Object.entries(localizations ?? {}) as [string, CommandLocalization][]) {
    for (const [key, o] of Object.entries(l.options ?? {}) as [string, OptionLocalization][]) {
      const at = `${path} option "${key}" (${locale})`;
      const option = options[key];
      if (!option) throw new AppConfigError(`${path} (${locale}): localizes option "${key}", which it does not have`);
      const target = (out.options[key] ??= {});
      if (o.name !== undefined) {
        checkName(`${at} name`, o.name);
        (target.name ??= {})[locale] = o.name;
      }
      if (o.description !== undefined) {
        checkLength(`${at} description`, o.description, 1, 100);
        (target.description ??= {})[locale] = o.description;
      }
      for (const [value, name] of Object.entries(o.choices ?? {})) {
        if (!option.spec.choices?.some((c) => String(c.value) === value)) throw new AppConfigError(`${at}: localizes choice "${value}", which it does not have`);
        checkLength(`${at} choice "${value}"`, name, 1, 100);
        ((target.choices ??= {})[value] ??= {})[locale] = name;
      }
    }
  }
  return out;
}

function withOptions<T>(options: T[]): { options?: T[] } {
  return options.length > 0 ? { options } : {};
}

function pickTopLevel(config: TopLevelConfig): TopLevelConfig {
  const out: Record<string, unknown> = {};
  for (const key of TOP_LEVEL_KEYS) if (config[key] !== undefined) out[key] = config[key];
  return out as TopLevelConfig;
}

const CONTEXTS: Record<InteractionContext, number> = { guild: 0, botDm: 1, privateChannel: 2 };
const INTEGRATION_TYPES: Record<IntegrationType, number> = { guildInstall: 0, userInstall: 1 };

function topLevelDefinition(config: TopLevelConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (config.contexts) out.contexts = config.contexts.map((c) => CONTEXTS[c]);
  if (config.integrationTypes) out.integration_types = config.integrationTypes.map((t) => INTEGRATION_TYPES[t]);
  if (config.defaultMemberPermissions !== undefined) {
    out.default_member_permissions = config.defaultMemberPermissions === null ? null : String(config.defaultMemberPermissions);
  }
  if (config.nsfw !== undefined) out.nsfw = config.nsfw;
  return out;
}
