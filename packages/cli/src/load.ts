// Loads the bot's App through Vite, with @composurejs/vite applied, so its modules (and their
// Inline Handlers) compile exactly as in the build. The bot's vite.config.ts is not used: its
// platform plugins (Workers, ...) are for serving and building, not for reading definitions.
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import composure from "@composurejs/vite"
import type { ScopedDefinition } from "composurejs"
import { runnerImport } from "vite"
import { SyncError } from "./sync.ts"

export interface LoadedApp {
  definitions(): ScopedDefinition[]
}

const isApp = (value: unknown): value is LoadedApp => typeof (value as LoadedApp | undefined)?.definitions === "function"

/** The module's `app` export, or its default export, if it is an App. */
export async function loadApp(root: string, entry: string): Promise<LoadedApp> {
  const file = resolve(root, entry)
  if (!existsSync(file)) throw new SyncError(`${entry} does not exist; pass --app <file exporting the App>`)
  const { module } = await runnerImport<Record<string, unknown>>(file, { root, plugins: [composure()], logLevel: "error" })
  const app = [module.app, module.default].find(isApp)
  if (!app) throw new SyncError(`${entry} must export the App as \`app\` or as its default export`)
  return app
}

/** `src/app.tsx`, `src/app.ts`, ...: the first that exists. */
export function defaultEntry(root: string): string {
  const candidates = ["src/app.tsx", "src/app.ts", "src/index.tsx", "src/index.ts"]
  return candidates.find((c) => existsSync(resolve(root, c))) ?? candidates[0]!
}
