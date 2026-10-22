// composurejs/rest: the Endpoints, as functions taking a client first (c.bot, c.client, or a
// BotClient built by hand for scripts and cron jobs).
export * from "./endpoints.ts"
export {
  BotClient,
  type Method,
  type Op,
  type Query,
  type RequestBody,
  type RequestInit,
  type ResponseBody,
  RestClient,
  type RestOptions,
  type Route,
  route,
} from "./client.ts"
export { InteractionClient } from "./interaction.ts"
export { type MessageBody, type MessageInput, toMessageBody } from "./message.ts"
export type { components as Schemas, operations as Operations } from "./schema.d.ts"
