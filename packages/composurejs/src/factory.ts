import { App, type AppOptions } from "./app.ts"
import {
  command,
  type CommandConfig,
  group,
  type GroupConfig,
  messageCommand,
  type MessageCommandConfig,
  userCommand,
  type UserCommandConfig,
} from "./command.ts"
import type { Middleware } from "./middleware.ts"
import type { Options } from "./options.ts"
import type { Env } from "./types.ts"

/**
 * Definers bound to one Env, so `c.env`, `c.data` and `c.var` are typed in modules that do
 * not see the App (TypeScript cannot infer Options while `E` is given explicitly):
 *
 * ```ts
 * export const { command, middleware } = createFactory<BotEnv>()
 * ```
 */
export function createFactory<E extends Env>() {
  return {
    app: (options?: AppOptions<E>) => new App<E>(options),
    command: <O extends Options = {}>(config: CommandConfig<E, O>) => command<O, E>(config),
    group: (config: GroupConfig<E>) => group<E>(config),
    userCommand: (config: UserCommandConfig<E>) => userCommand<E>(config),
    messageCommand: (config: MessageCommandConfig<E>) => messageCommand<E>(config),
    middleware: (fn: Middleware<E>): Middleware<E> => fn,
  }
}
