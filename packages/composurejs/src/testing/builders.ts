// Interaction builders shaped like what Discord sends today.
import type {
  APIApplicationCommandAutocompleteInteraction,
  APIMessage,
  APIMessageApplicationCommandInteraction,
  APIMessageComponentInteraction,
  APIModalSubmitInteraction,
  APIPingInteraction,
  APIUserApplicationCommandInteraction,
} from "discord-api-types/v10"
import type { ChatInputInteraction, Interaction, Member, User } from "../discord.ts"
import { type Attachment, OptionType, type PartialChannel, type ResolvedMember, type Role } from "../options.ts"

export const TEST_APPLICATION_ID = "1052322265397739523"
export const TEST_GUILD_ID = "798662131062931547"
export const TEST_CHANNEL_ID = "300000000000000001"

export const testUser: User = {
  id: "100000000000000001",
  username: "alice",
  global_name: "Alice",
  discriminator: "0",
  avatar: null,
}

/** A full user from a partial one; unset fields get neutral defaults, never another user's. */
function toUser(user: WithId<User>): User {
  return { username: `user${user.id}`, global_name: null, discriminator: "0", avatar: null, ...user }
}

let nextId = 900000000000000000n
const snowflake = () => String(nextId++)

/** Something that builds an Interaction; `answer` accepts it directly. */
export interface Buildable<I extends Interaction = Interaction> {
  build(): I
}

type Data = Record<string, unknown>
type WithId<T> = Partial<T> & { id: string }

const JOINED_AT = "2024-01-01T00:00:00.000Z"
const PERMISSIONS = "2248473465835073"

/** Who invokes the Interaction and where; shared by every builder. */
abstract class InteractionBuilder<I extends Interaction> implements Buildable<I> {
  #user: User = testUser
  #guildId: string | undefined = TEST_GUILD_ID
  #member: Partial<Member> = {}
  #locale = "en-US"
  #appPermissions = PERMISSIONS

  protected abstract readonly type: number
  protected abstract data(): Data | undefined
  protected extra(): Data {
    return {}
  }

  protected get inGuildNow(): boolean {
    return this.#guildId !== undefined
  }

  /** Invoked by `user` (default Alice). */
  by(user: WithId<User>): this {
    this.#user = toUser(user)
    return this
  }

  /** In guild `guildId` (the default guild unless `inDm` was called), as a member with `member`'s fields. */
  inGuild(guildId: string = TEST_GUILD_ID, member: Partial<Member> = {}): this {
    this.#guildId = guildId
    this.#member = member
    return this
  }

  /** The bot's permissions in the channel (`app_permissions`), as flags or Discord's decimal string. */
  appPermissions(permissions: bigint | string): this {
    this.#appPermissions = String(permissions)
    return this
  }

  /** In the bot's DM, so `user` is set instead of `member`. */
  inDm(): this {
    this.#guildId = undefined
    return this
  }

  locale(locale: string): this {
    this.#locale = locale
    return this
  }

  build(): I {
    const inGuild = this.inGuildNow
    const who = inGuild
      ? {
          guild_id: this.#guildId,
          guild_locale: "en-US",
          member: { user: this.#user, roles: [], joined_at: JOINED_AT, deaf: false, mute: false, flags: 0, permissions: PERMISSIONS, ...this.#member },
          context: 0,
        }
      : { user: this.#user, context: 1 }
    const data = this.data()
    return {
      id: snowflake(),
      application_id: TEST_APPLICATION_ID,
      type: this.type,
      ...(data && { data }),
      channel: { id: TEST_CHANNEL_ID, type: inGuild ? 0 : 1 },
      channel_id: TEST_CHANNEL_ID,
      token: "test-interaction-token",
      version: 1,
      app_permissions: this.#appPermissions,
      locale: this.#locale,
      entitlements: [],
      authorizing_integration_owners: { "0": TEST_GUILD_ID },
      attachment_size_limit: 10485760,
      ...who,
      ...this.extra(),
    } as unknown as I
  }
}

// JSON as Discord sends it; the builders' parameters carry the types.
type Resolved = Record<"users" | "members" | "roles" | "channels" | "attachments" | "messages", Record<string, Data>>

/** Shared by the Command builders: resolved data for Option values and targets. */
abstract class ResolvingBuilder<I extends Interaction> extends InteractionBuilder<I> {
  protected readonly resolved: Resolved = { users: {}, members: {}, roles: {}, channels: {}, attachments: {}, messages: {} }
  // Member data depends on where it is invoked, known only at build.
  protected users = new Map<string, [User, Partial<ResolvedMember> | undefined]>()

  protected resolveUser(user: WithId<User>, member?: Partial<ResolvedMember>): string {
    this.users.set(user.id, [toUser(user), member])
    return user.id
  }

  protected resolvedData(): Data | undefined {
    for (const [id, [user, member]] of this.users) {
      this.resolved.users[id] = { ...user }
      if (this.inGuildNow) this.resolved.members[id] = { roles: [], joined_at: JOINED_AT, flags: 0, permissions: PERMISSIONS, ...member }
    }
    const nonEmpty = Object.entries(this.resolved).filter(([, map]) => Object.keys(map).length > 0)
    return nonEmpty.length > 0 ? Object.fromEntries(nonEmpty) : undefined
  }
}

class ChatInputBuilder<I extends Interaction> extends ResolvingBuilder<I> {
  protected readonly type: number = 2
  #path: string[] = []
  protected readonly options: Data[] = []

  constructor(readonly name: string) {
    super()
  }

  /** Addresses a subcommand: `.subcommand("ban")`, or `.subcommand("role", "add")` in a nested Group. */
  subcommand(...path: [string] | [string, string]): this {
    this.#path = path
    return this
  }

  /** A string, integer (whole number), number or boolean Option value. */
  option(name: string, value: string | number | boolean): this {
    const type = typeof value === "string" ? OptionType.String : typeof value === "boolean" ? OptionType.Boolean : Number.isInteger(value) ? OptionType.Integer : OptionType.Number
    this.options.push({ name, type, value })
    return this
  }

  /** A User Option; `member` adds member data when invoked in a guild. */
  user(name: string, user: WithId<User>, member?: Partial<ResolvedMember>): this {
    this.options.push({ name, type: OptionType.User, value: this.resolveUser(user, member) })
    return this
  }

  channel(name: string, channel: WithId<PartialChannel>): this {
    this.resolved.channels[channel.id] = { type: 0, name: "general", permissions: PERMISSIONS, ...channel }
    this.options.push({ name, type: OptionType.Channel, value: channel.id })
    return this
  }

  role(name: string, role: WithId<Role>): this {
    this.resolved.roles[role.id] = { name: "role", color: 0, hoist: false, position: 1, permissions: "0", managed: false, mentionable: true, flags: 0, ...role }
    this.options.push({ name, type: OptionType.Role, value: role.id })
    return this
  }

  attachment(name: string, attachment: WithId<Attachment>): this {
    this.resolved.attachments[attachment.id] = { filename: "file.txt", size: 1, url: "https://cdn.test/file.txt", proxy_url: "https://cdn.test/file.txt", ...attachment }
    this.options.push({ name, type: OptionType.Attachment, value: attachment.id })
    return this
  }

  protected data(): Data {
    const [first, second] = this.#path
    const leaf = this.options
    const options =
      second !== undefined
        ? [{ type: OptionType.SubcommandGroup, name: first, options: [{ type: OptionType.Subcommand, name: second, options: leaf }] }]
        : first !== undefined
          ? [{ type: OptionType.Subcommand, name: first, options: leaf }]
          : leaf
    const resolved = this.resolvedData()
    return { id: snowflake(), name: this.name, type: 1, ...(options.length > 0 && { options }), ...(resolved && { resolved }) }
  }
}

class AutocompleteBuilder extends ChatInputBuilder<APIApplicationCommandAutocompleteInteraction> {
  protected override readonly type: number = 4

  /** The Option being typed into, with its partial input. */
  focused(name: string, input: string, type: number = OptionType.String): this {
    this.options.push({ name, type, value: input, focused: true })
    return this
  }
}

class UserCommandBuilder extends ResolvingBuilder<APIUserApplicationCommandInteraction> {
  protected readonly type = 2
  #target: string

  constructor(readonly name: string) {
    super()
    this.#target = this.resolveUser(testUser)
  }

  /** The clicked user (default Alice). */
  target(user: WithId<User>, member?: Partial<ResolvedMember>): this {
    this.users.clear()
    this.#target = this.resolveUser(user, member)
    return this
  }

  protected data(): Data {
    return { id: snowflake(), name: this.name, type: 2, target_id: this.#target, resolved: this.resolvedData() }
  }
}

class MessageCommandBuilder extends ResolvingBuilder<APIMessageApplicationCommandInteraction> {
  protected readonly type = 2
  #target = ""

  constructor(readonly name: string) {
    super()
    this.target({})
  }

  /** The clicked message (default: "hello" by Alice). */
  target(message: Partial<APIMessage>): this {
    const id = message.id ?? snowflake()
    this.resolved.messages = {
      [id]: {
        id,
        channel_id: TEST_CHANNEL_ID,
        author: testUser,
        content: "hello",
        timestamp: JOINED_AT,
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        mention_roles: [],
        attachments: [],
        embeds: [],
        pinned: false,
        type: 0,
        ...message,
      },
    }
    this.#target = id
    return this
  }

  protected data(): Data {
    return { id: snowflake(), name: this.name, type: 3, target_id: this.#target, resolved: this.resolvedData() }
  }
}

class ComponentBuilder extends InteractionBuilder<APIMessageComponentInteraction> {
  protected readonly type = 3
  #values: string[] | undefined
  #componentType: number | undefined
  #message: Data = { components: [], flags: 0 }

  constructor(readonly customId: string) {
    super()
  }

  /** Selected values, making this a select (string select unless `componentType` says otherwise). */
  values(values: string[], componentType = 3): this {
    this.#values = values
    this.#componentType = componentType
    return this
  }

  /** The message the component is on (its `components` and `flags`). */
  onMessage(message: Data): this {
    this.#message = message
    return this
  }

  protected data(): Data {
    return this.#values ? { custom_id: this.customId, component_type: this.#componentType, values: this.#values } : { custom_id: this.customId, component_type: 2 }
  }

  protected override extra(): Data {
    return { message: { id: snowflake(), channel_id: TEST_CHANNEL_ID, type: 0, content: "", ...this.#message } }
  }
}

/** A value submitted for one modal input. */
export type SubmittedValue = string | boolean | string[] | null

class ModalSubmitBuilder extends ResolvingBuilder<APIModalSubmitInteraction> {
  protected readonly type = 5
  readonly #inputs: Data[] = []
  #message: Data | undefined

  constructor(readonly customId: string) {
    super()
  }

  /** An input's value: a string for a text input or radio group, a boolean for a checkbox, a list for selects and checkbox groups. */
  field(customId: string, value: SubmittedValue): this {
    const component =
      typeof value === "boolean"
        ? { type: 23, custom_id: customId, value }
        : Array.isArray(value)
          ? { type: 3, custom_id: customId, values: value }
          : value === null
            ? { type: 21, custom_id: customId, value: null }
            : { type: 4, custom_id: customId, value }
    this.#inputs.push({ type: 18, component })
    return this
  }

  /** Files uploaded to a `<FileUpload>`. */
  files(customId: string, attachments: WithId<Attachment>[]): this {
    for (const a of attachments) this.resolved.attachments[a.id] = { filename: "file.txt", size: 1, url: `https://cdn.test/${a.id}`, proxy_url: `https://cdn.test/${a.id}`, ...a }
    this.#inputs.push({ type: 18, component: { type: 19, custom_id: customId, values: attachments.map((a) => a.id) } })
    return this
  }

  /** Opened from a component on this message, so the submit can Update it. */
  onMessage(message: Data): this {
    this.#message = message
    return this
  }

  protected data(): Data {
    const resolved = this.resolvedData()
    return { custom_id: this.customId, components: this.#inputs, ...(resolved && { resolved }) }
  }

  protected override extra(): Data {
    return this.#message ? { message: { id: snowflake(), channel_id: TEST_CHANNEL_ID, type: 0, content: "", ...this.#message } } : {}
  }
}

export function ping(): Buildable<APIPingInteraction> {
  return { build: () => ({ id: snowflake(), application_id: TEST_APPLICATION_ID, type: 1, token: "test-interaction-token", version: 1 }) as unknown as APIPingInteraction }
}

/** A chat input Command invocation of `/name`. */
export function chatInput(name: string): ChatInputBuilder<ChatInputInteraction> {
  return new ChatInputBuilder(name)
}

/** Autocomplete for `/name`; set the typed-into Option with `.focused(name, input)`. */
export function autocomplete(name: string): AutocompleteBuilder {
  return new AutocompleteBuilder(name)
}

/** A user context menu Command invocation; set the clicked user with `.target(user)`. */
export function userCommand(name: string): UserCommandBuilder {
  return new UserCommandBuilder(name)
}

/** A message context menu Command invocation; set the clicked message with `.target(message)`. */
export function messageCommand(name: string): MessageCommandBuilder {
  return new MessageCommandBuilder(name)
}

/** A click on a component with `customId`; `.values([..])` makes it a select. */
export function component(customId: string): ComponentBuilder {
  return new ComponentBuilder(customId)
}

/** A modal submit of the modal with `customId`; add inputs with `.field(id, value)`. */
export function modalSubmit(customId: string): ModalSubmitBuilder {
  return new ModalSubmitBuilder(customId)
}

export type { AutocompleteBuilder, ChatInputBuilder, ComponentBuilder, InteractionBuilder, MessageCommandBuilder, ModalSubmitBuilder, UserCommandBuilder }
