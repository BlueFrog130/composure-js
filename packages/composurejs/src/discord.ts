// Wire Types come from discord-api-types (ADR 0003), imported as types only. Its enums are
// runtime objects, so the numbers core compares against are restated here.
import type {
  APIApplicationCommandAutocompleteInteraction,
  APIApplicationCommandInteraction,
  APIChatInputApplicationCommandInteraction,
  APIEntitlement,
  APIInteraction,
  APIInteractionGuildMember,
  APIInteractionResponse,
  APIMessageComponentInteraction,
  APIModalSubmitInteraction,
  APIPingInteraction,
  APIUser,
} from "discord-api-types/v10"

export type { APIInteractionResponse as InteractionResponse, APIInteractionGuildMember as Member, APIUser as User, APIEntitlement as Entitlement }

/** Any Interaction, including kinds this version does not know (passed through raw). */
export type Interaction =
  | APIPingInteraction
  | APIApplicationCommandInteraction
  | APIMessageComponentInteraction
  | APIApplicationCommandAutocompleteInteraction
  | APIModalSubmitInteraction

export type ChatInputInteraction = APIChatInputApplicationCommandInteraction
export type KnownInteraction = APIInteraction

export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
  ApplicationCommandAutocomplete: 4,
  ModalSubmit: 5,
} as const

export const CommandType = {
  ChatInput: 1,
  User: 2,
  Message: 3,
} as const

export const ResponseType = {
  Pong: 1,
  ChannelMessageWithSource: 4,
  DeferredChannelMessageWithSource: 5,
  DeferredMessageUpdate: 6,
  UpdateMessage: 7,
  ApplicationCommandAutocompleteResult: 8,
  Modal: 9,
} as const

export const MessageFlags = {
  Ephemeral: 1 << 6,
  SuppressNotifications: 1 << 12,
  IsComponentsV2: 1 << 15,
} as const
