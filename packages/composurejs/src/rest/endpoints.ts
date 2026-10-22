// Tier 1 Endpoints (ADR 0006): channels, messages, guilds, members, roles, webhooks, users.
// Plain functions taking the client first, so a bundle keeps only those it calls. Paths are
// copied from Discord's OpenAPI spec; test/rest-spec.test.ts checks each one against it.
import { type MessageInput, toMessageBody } from "./message.ts"
import { type Query, type RequestBody, type ResponseBody, type RestClient, route } from "./client.ts"

/** Every Endpoint implemented, for the spec check. */
export const ROUTES = {
  // Channels
  getChannel: route("GET", "/channels/{channel_id}", "get_channel"),
  modifyChannel: route("PATCH", "/channels/{channel_id}", "update_channel"),
  deleteChannel: route("DELETE", "/channels/{channel_id}", "delete_channel"),
  triggerTyping: route("POST", "/channels/{channel_id}/typing", "trigger_typing_indicator"),
  createDM: route("POST", "/users/@me/channels", "create_dm"),
  // Messages
  getMessages: route("GET", "/channels/{channel_id}/messages", "list_messages"),
  getMessage: route("GET", "/channels/{channel_id}/messages/{message_id}", "get_message"),
  createMessage: route("POST", "/channels/{channel_id}/messages", "create_message"),
  editMessage: route("PATCH", "/channels/{channel_id}/messages/{message_id}", "update_message"),
  deleteMessage: route("DELETE", "/channels/{channel_id}/messages/{message_id}", "delete_message"),
  bulkDeleteMessages: route("POST", "/channels/{channel_id}/messages/bulk-delete", "bulk_delete_messages"),
  crosspostMessage: route("POST", "/channels/{channel_id}/messages/{message_id}/crosspost", "crosspost_message"),
  addReaction: route("PUT", "/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me", "add_my_message_reaction"),
  removeOwnReaction: route("DELETE", "/channels/{channel_id}/messages/{message_id}/reactions/{emoji_name}/@me", "delete_my_message_reaction"),
  getPins: route("GET", "/channels/{channel_id}/messages/pins", "list_pins"),
  pinMessage: route("PUT", "/channels/{channel_id}/messages/pins/{message_id}", "create_pin"),
  unpinMessage: route("DELETE", "/channels/{channel_id}/messages/pins/{message_id}", "delete_pin"),
  // Guilds
  getGuild: route("GET", "/guilds/{guild_id}", "get_guild"),
  modifyGuild: route("PATCH", "/guilds/{guild_id}", "update_guild"),
  getGuildChannels: route("GET", "/guilds/{guild_id}/channels", "list_guild_channels"),
  createGuildChannel: route("POST", "/guilds/{guild_id}/channels", "create_guild_channel"),
  // Members
  getMember: route("GET", "/guilds/{guild_id}/members/{user_id}", "get_guild_member"),
  listMembers: route("GET", "/guilds/{guild_id}/members", "list_guild_members"),
  searchMembers: route("GET", "/guilds/{guild_id}/members/search", "search_guild_members"),
  modifyMember: route("PATCH", "/guilds/{guild_id}/members/{user_id}", "update_guild_member"),
  modifyCurrentMember: route("PATCH", "/guilds/{guild_id}/members/@me", "update_my_guild_member"),
  addMemberRole: route("PUT", "/guilds/{guild_id}/members/{user_id}/roles/{role_id}", "add_guild_member_role"),
  removeMemberRole: route("DELETE", "/guilds/{guild_id}/members/{user_id}/roles/{role_id}", "delete_guild_member_role"),
  kickMember: route("DELETE", "/guilds/{guild_id}/members/{user_id}", "delete_guild_member"),
  banMember: route("PUT", "/guilds/{guild_id}/bans/{user_id}", "ban_user_from_guild"),
  unbanMember: route("DELETE", "/guilds/{guild_id}/bans/{user_id}", "unban_user_from_guild"),
  // Roles
  getRoles: route("GET", "/guilds/{guild_id}/roles", "list_guild_roles"),
  getRole: route("GET", "/guilds/{guild_id}/roles/{role_id}", "get_guild_role"),
  createRole: route("POST", "/guilds/{guild_id}/roles", "create_guild_role"),
  modifyRole: route("PATCH", "/guilds/{guild_id}/roles/{role_id}", "update_guild_role"),
  deleteRole: route("DELETE", "/guilds/{guild_id}/roles/{role_id}", "delete_guild_role"),
  // Webhooks
  createWebhook: route("POST", "/channels/{channel_id}/webhooks", "create_webhook"),
  getChannelWebhooks: route("GET", "/channels/{channel_id}/webhooks", "list_channel_webhooks"),
  getGuildWebhooks: route("GET", "/guilds/{guild_id}/webhooks", "get_guild_webhooks"),
  getWebhook: route("GET", "/webhooks/{webhook_id}", "get_webhook"),
  modifyWebhook: route("PATCH", "/webhooks/{webhook_id}", "update_webhook"),
  deleteWebhook: route("DELETE", "/webhooks/{webhook_id}", "delete_webhook"),
  executeWebhook: route("POST", "/webhooks/{webhook_id}/{webhook_token}", "execute_webhook"),
  // The application
  getCurrentApplication: route("GET", "/applications/@me", "get_my_application"),
  editCurrentApplication: route("PATCH", "/applications/@me", "update_my_application"),
  // Application Commands (Sync)
  getGlobalCommands: route("GET", "/applications/{application_id}/commands", "list_application_commands"),
  bulkOverwriteGlobalCommands: route("PUT", "/applications/{application_id}/commands", "bulk_set_application_commands"),
  getGuildCommands: route("GET", "/applications/{application_id}/guilds/{guild_id}/commands", "list_guild_application_commands"),
  bulkOverwriteGuildCommands: route("PUT", "/applications/{application_id}/guilds/{guild_id}/commands", "bulk_set_guild_application_commands"),
  // Users
  getCurrentUser: route("GET", "/users/@me", "get_my_user"),
  getUser: route("GET", "/users/{user_id}", "get_user"),
  // Interaction Client
  getOriginalResponse: route("GET", "/webhooks/{webhook_id}/{webhook_token}/messages/@original", "get_original_webhook_message"),
  editOriginalResponse: route("PATCH", "/webhooks/{webhook_id}/{webhook_token}/messages/@original", "update_original_webhook_message"),
  deleteOriginalResponse: route("DELETE", "/webhooks/{webhook_id}/{webhook_token}/messages/@original", "delete_original_webhook_message"),
  getFollowup: route("GET", "/webhooks/{webhook_id}/{webhook_token}/messages/{message_id}", "get_webhook_message"),
  editFollowup: route("PATCH", "/webhooks/{webhook_id}/{webhook_token}/messages/{message_id}", "update_webhook_message"),
  deleteFollowup: route("DELETE", "/webhooks/{webhook_id}/{webhook_token}/messages/{message_id}", "delete_webhook_message"),
  createInteractionResponse: route("POST", "/interactions/{interaction_id}/{interaction_token}/callback", "create_interaction_response"),
} as const

type R = typeof ROUTES
type Res<K extends keyof R> = Promise<ResponseBody<R[K]["op"]>>
type Body<K extends keyof R> = RequestBody<R[K]["op"]>
type Q<K extends keyof R> = Query<R[K]["op"]>
/** Options every mutating Endpoint takes. */
export interface Audit {
  /** Shown in the guild's audit log. */
  reason?: string
}

// ---- Channels ------------------------------------------------------------------------------

export const getChannel = (rest: RestClient, channelId: string): Res<"getChannel"> => rest.request(ROUTES.getChannel, { params: { channel_id: channelId } })

export const modifyChannel = (rest: RestClient, channelId: string, body: Body<"modifyChannel">, audit: Audit = {}): Res<"modifyChannel"> =>
  rest.request(ROUTES.modifyChannel, { params: { channel_id: channelId }, body, ...audit })

export const deleteChannel = (rest: RestClient, channelId: string, audit: Audit = {}): Res<"deleteChannel"> =>
  rest.request(ROUTES.deleteChannel, { params: { channel_id: channelId }, ...audit })

export const triggerTyping = (rest: RestClient, channelId: string): Res<"triggerTyping"> => rest.request(ROUTES.triggerTyping, { params: { channel_id: channelId } })

/** Opens (or returns) the DM channel with a user. */
export const createDM = (rest: RestClient, userId: string): Res<"createDM"> => rest.request(ROUTES.createDM, { body: { recipient_id: userId } })

// ---- Messages ------------------------------------------------------------------------------

export const getMessages = (rest: RestClient, channelId: string, query: Q<"getMessages"> = {}): Res<"getMessages"> =>
  rest.request(ROUTES.getMessages, { params: { channel_id: channelId }, query })

export const getMessage = (rest: RestClient, channelId: string, messageId: string): Res<"getMessage"> =>
  rest.request(ROUTES.getMessage, { params: { channel_id: channelId, message_id: messageId } })

/** Sends a message: text, a View (rendered and checked like a response), or a raw body. */
export async function createMessage(rest: RestClient, channelId: string, message: MessageInput<Body<"createMessage">>): Res<"createMessage"> {
  const { json, files } = await toMessageBody(message)
  return rest.request(ROUTES.createMessage, { params: { channel_id: channelId }, body: json, files })
}

export async function editMessage(rest: RestClient, channelId: string, messageId: string, message: MessageInput<Body<"editMessage">>): Res<"editMessage"> {
  const { json, files } = await toMessageBody(message)
  return rest.request(ROUTES.editMessage, { params: { channel_id: channelId, message_id: messageId }, body: json, files })
}

export const deleteMessage = (rest: RestClient, channelId: string, messageId: string, audit: Audit = {}): Res<"deleteMessage"> =>
  rest.request(ROUTES.deleteMessage, { params: { channel_id: channelId, message_id: messageId }, ...audit })

/** Deletes 2-100 messages younger than two weeks. */
export const bulkDeleteMessages = (rest: RestClient, channelId: string, messageIds: string[], audit: Audit = {}): Res<"bulkDeleteMessages"> =>
  rest.request(ROUTES.bulkDeleteMessages, { params: { channel_id: channelId }, body: { messages: messageIds }, ...audit })

/** Publishes a message in an announcement channel to its followers. */
export const crosspostMessage = (rest: RestClient, channelId: string, messageId: string): Res<"crosspostMessage"> =>
  rest.request(ROUTES.crosspostMessage, { params: { channel_id: channelId, message_id: messageId } })

/** `emoji`: `"👍"` or a custom emoji as `name:id`. */
export const addReaction = (rest: RestClient, channelId: string, messageId: string, emoji: string): Res<"addReaction"> =>
  rest.request(ROUTES.addReaction, { params: { channel_id: channelId, message_id: messageId, emoji_name: emoji } })

export const removeOwnReaction = (rest: RestClient, channelId: string, messageId: string, emoji: string): Res<"removeOwnReaction"> =>
  rest.request(ROUTES.removeOwnReaction, { params: { channel_id: channelId, message_id: messageId, emoji_name: emoji } })

export const getPins = (rest: RestClient, channelId: string, query: Q<"getPins"> = {}): Res<"getPins"> => rest.request(ROUTES.getPins, { params: { channel_id: channelId }, query })

export const pinMessage = (rest: RestClient, channelId: string, messageId: string, audit: Audit = {}): Res<"pinMessage"> =>
  rest.request(ROUTES.pinMessage, { params: { channel_id: channelId, message_id: messageId }, ...audit })

export const unpinMessage = (rest: RestClient, channelId: string, messageId: string, audit: Audit = {}): Res<"unpinMessage"> =>
  rest.request(ROUTES.unpinMessage, { params: { channel_id: channelId, message_id: messageId }, ...audit })

// ---- Guilds --------------------------------------------------------------------------------

export const getGuild = (rest: RestClient, guildId: string, query: Q<"getGuild"> = {}): Res<"getGuild"> => rest.request(ROUTES.getGuild, { params: { guild_id: guildId }, query })

export const modifyGuild = (rest: RestClient, guildId: string, body: Body<"modifyGuild">, audit: Audit = {}): Res<"modifyGuild"> =>
  rest.request(ROUTES.modifyGuild, { params: { guild_id: guildId }, body, ...audit })

export const getGuildChannels = (rest: RestClient, guildId: string): Res<"getGuildChannels"> => rest.request(ROUTES.getGuildChannels, { params: { guild_id: guildId } })

export const createGuildChannel = (rest: RestClient, guildId: string, body: Body<"createGuildChannel">, audit: Audit = {}): Res<"createGuildChannel"> =>
  rest.request(ROUTES.createGuildChannel, { params: { guild_id: guildId }, body, ...audit })

// ---- Members -------------------------------------------------------------------------------

export const getMember = (rest: RestClient, guildId: string, userId: string): Res<"getMember"> => rest.request(ROUTES.getMember, { params: { guild_id: guildId, user_id: userId } })

export const listMembers = (rest: RestClient, guildId: string, query: Q<"listMembers"> = {}): Res<"listMembers"> =>
  rest.request(ROUTES.listMembers, { params: { guild_id: guildId }, query })

export const searchMembers = (rest: RestClient, guildId: string, query: Q<"searchMembers">): Res<"searchMembers"> =>
  rest.request(ROUTES.searchMembers, { params: { guild_id: guildId }, query })

export const modifyMember = (rest: RestClient, guildId: string, userId: string, body: Body<"modifyMember">, audit: Audit = {}): Res<"modifyMember"> =>
  rest.request(ROUTES.modifyMember, { params: { guild_id: guildId, user_id: userId }, body, ...audit })

export const modifyCurrentMember = (rest: RestClient, guildId: string, body: Body<"modifyCurrentMember">, audit: Audit = {}): Res<"modifyCurrentMember"> =>
  rest.request(ROUTES.modifyCurrentMember, { params: { guild_id: guildId }, body, ...audit })

export const addMemberRole = (rest: RestClient, guildId: string, userId: string, roleId: string, audit: Audit = {}): Res<"addMemberRole"> =>
  rest.request(ROUTES.addMemberRole, { params: { guild_id: guildId, user_id: userId, role_id: roleId }, ...audit })

export const removeMemberRole = (rest: RestClient, guildId: string, userId: string, roleId: string, audit: Audit = {}): Res<"removeMemberRole"> =>
  rest.request(ROUTES.removeMemberRole, { params: { guild_id: guildId, user_id: userId, role_id: roleId }, ...audit })

export const kickMember = (rest: RestClient, guildId: string, userId: string, audit: Audit = {}): Res<"kickMember"> =>
  rest.request(ROUTES.kickMember, { params: { guild_id: guildId, user_id: userId }, ...audit })

export const banMember = (rest: RestClient, guildId: string, userId: string, body: Body<"banMember"> = {}, audit: Audit = {}): Res<"banMember"> =>
  rest.request(ROUTES.banMember, { params: { guild_id: guildId, user_id: userId }, body, ...audit })

export const unbanMember = (rest: RestClient, guildId: string, userId: string, audit: Audit = {}): Res<"unbanMember"> =>
  rest.request(ROUTES.unbanMember, { params: { guild_id: guildId, user_id: userId }, ...audit })

// ---- Roles ---------------------------------------------------------------------------------

export const getRoles = (rest: RestClient, guildId: string): Res<"getRoles"> => rest.request(ROUTES.getRoles, { params: { guild_id: guildId } })

export const getRole = (rest: RestClient, guildId: string, roleId: string): Res<"getRole"> => rest.request(ROUTES.getRole, { params: { guild_id: guildId, role_id: roleId } })

export const createRole = (rest: RestClient, guildId: string, body: Body<"createRole">, audit: Audit = {}): Res<"createRole"> =>
  rest.request(ROUTES.createRole, { params: { guild_id: guildId }, body, ...audit })

export const modifyRole = (rest: RestClient, guildId: string, roleId: string, body: Body<"modifyRole">, audit: Audit = {}): Res<"modifyRole"> =>
  rest.request(ROUTES.modifyRole, { params: { guild_id: guildId, role_id: roleId }, body, ...audit })

export const deleteRole = (rest: RestClient, guildId: string, roleId: string, audit: Audit = {}): Res<"deleteRole"> =>
  rest.request(ROUTES.deleteRole, { params: { guild_id: guildId, role_id: roleId }, ...audit })

// ---- Webhooks ------------------------------------------------------------------------------

export const createWebhook = (rest: RestClient, channelId: string, body: Body<"createWebhook">, audit: Audit = {}): Res<"createWebhook"> =>
  rest.request(ROUTES.createWebhook, { params: { channel_id: channelId }, body, ...audit })

export const getChannelWebhooks = (rest: RestClient, channelId: string): Res<"getChannelWebhooks"> => rest.request(ROUTES.getChannelWebhooks, { params: { channel_id: channelId } })

export const getGuildWebhooks = (rest: RestClient, guildId: string): Res<"getGuildWebhooks"> => rest.request(ROUTES.getGuildWebhooks, { params: { guild_id: guildId } })

export const getWebhook = (rest: RestClient, webhookId: string): Res<"getWebhook"> => rest.request(ROUTES.getWebhook, { params: { webhook_id: webhookId } })

export const modifyWebhook = (rest: RestClient, webhookId: string, body: Body<"modifyWebhook">, audit: Audit = {}): Res<"modifyWebhook"> =>
  rest.request(ROUTES.modifyWebhook, { params: { webhook_id: webhookId }, body, ...audit })

export const deleteWebhook = (rest: RestClient, webhookId: string, audit: Audit = {}): Res<"deleteWebhook"> =>
  rest.request(ROUTES.deleteWebhook, { params: { webhook_id: webhookId }, ...audit })

/** Sends through a webhook (by its token; needs no bot token). Waits for the message, which it returns. */
export async function executeWebhook(
  rest: RestClient,
  webhookId: string,
  token: string,
  message: MessageInput<Body<"executeWebhook">>,
  query: Q<"executeWebhook"> = {},
): Res<"executeWebhook"> {
  const { json, files } = await toMessageBody(message)
  const withComponents = json.components !== undefined ? { with_components: true } : {}
  return rest.request(ROUTES.executeWebhook, { params: { webhook_id: webhookId, webhook_token: token }, query: { wait: true, ...withComponents, ...query }, body: json, files })
}

// ---- The application -----------------------------------------------------------------------

/** The bot's own application. */
export const getCurrentApplication = (rest: RestClient): Res<"getCurrentApplication"> => rest.request(ROUTES.getCurrentApplication)

/** Edits the bot's application, e.g. its `interactions_endpoint_url` (Discord PINGs a new URL before accepting it). */
export const editCurrentApplication = (rest: RestClient, body: Body<"editCurrentApplication">): Res<"editCurrentApplication"> =>
  rest.request(ROUTES.editCurrentApplication, { body })

// ---- Application Commands ------------------------------------------------------------------

/** The Command Definitions Discord stores globally. */
export const getGlobalCommands = (rest: RestClient, applicationId: string, query: Q<"getGlobalCommands"> = {}): Res<"getGlobalCommands"> =>
  rest.request(ROUTES.getGlobalCommands, { params: { application_id: applicationId }, query })

/** Replaces every global Command Definition with `commands`, creating, updating and deleting in one request. */
export const bulkOverwriteGlobalCommands = (rest: RestClient, applicationId: string, commands: Body<"bulkOverwriteGlobalCommands">): Res<"bulkOverwriteGlobalCommands"> =>
  rest.request(ROUTES.bulkOverwriteGlobalCommands, { params: { application_id: applicationId }, body: commands })

export const getGuildCommands = (rest: RestClient, applicationId: string, guildId: string, query: Q<"getGuildCommands"> = {}): Res<"getGuildCommands"> =>
  rest.request(ROUTES.getGuildCommands, { params: { application_id: applicationId, guild_id: guildId }, query })

/** Replaces every Command Definition in one guild with `commands`. */
export const bulkOverwriteGuildCommands = (
  rest: RestClient,
  applicationId: string,
  guildId: string,
  commands: Body<"bulkOverwriteGuildCommands">,
): Res<"bulkOverwriteGuildCommands"> => rest.request(ROUTES.bulkOverwriteGuildCommands, { params: { application_id: applicationId, guild_id: guildId }, body: commands })

// ---- Users ---------------------------------------------------------------------------------

export const getCurrentUser = (rest: RestClient): Res<"getCurrentUser"> => rest.request(ROUTES.getCurrentUser)

export const getUser = (rest: RestClient, userId: string): Res<"getUser"> => rest.request(ROUTES.getUser, { params: { user_id: userId } })
