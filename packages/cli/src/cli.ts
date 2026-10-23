// The `composure` command: commander parses, @clack/prompts shows (through Ui, so tests can record it).
import { resolve } from "node:path"
import { Command, CommanderError, InvalidArgumentError, Option } from "commander"
import type { Transport } from "composurejs"
import { loadEnv } from "vite"
import pkg from "../package.json" with { type: "json" }
import { defaultEntry, loadApp } from "./load.ts"
import { apply, configFromEnv, counts, formatPlan, hasChanges, plan, SCOPE_VAR_PREFIX, summary, SyncError } from "composurejs/sync"
import type { Ui } from "./ui.ts"

export interface Io {
  env: Record<string, string | undefined>
  ui: Ui
  /** Where commander writes help, version and usage errors. */
  out(text: string): void
  err(text: string): void
  /** For tests: where REST requests go. */
  transport?: Transport | undefined
  /** Read the .env files under the root (default true); tests turn it off. */
  readEnvFiles?: boolean | undefined
}

export interface SyncOptions {
  app?: string
  root: string
  mode: string
  guild?: string
  dryRun?: boolean
  check?: boolean
  yes?: boolean
}

const ENV_HELP = `
Environment (the process env wins over the root's env files, which Vite loads for --mode):
  DISCORD_TOKEN                   the bot token
  DISCORD_APPLICATION_ID          the application id (default: read from the token)
  ${SCOPE_VAR_PREFIX}<NAME>        guild ids for Commands with scope "<name>", comma-separated

Env files:
  .env.local                      the Dev Application's secrets (sync it with --mode development)
  .env.production.local           production's; read in production mode only (the default),
                                  where it wins over .env.local

Exit status: 0 synced or up to date, 1 failed or cancelled, 2 out of date (--check).`

function guildId(value: string): string {
  if (!/^\d{17,20}$/.test(value)) throw new InvalidArgumentError("not a guild id")
  return value
}

/** Runs the CLI; resolves to the exit status. */
export async function main(argv: string[], io: Io): Promise<number> {
  let status = 0
  const program = new Command("composure")
    .description("The composurejs command line")
    .version(pkg.version, "-v, --version")
    .exitOverride()
    .configureOutput({ writeOut: (text) => io.out(text.trimEnd()), writeErr: (text) => io.err(text.trimEnd()) })

  program
    .command("sync")
    .description("Make Discord's Command Definitions match the App's: show the plan, then apply it after confirming. Extra Commands Discord has are deleted.")
    .option("--app <file>", "module exporting the App as `app` or default (default: src/app.tsx)")
    .option("--root <dir>", "project root", ".")
    .option("--mode <mode>", "which .env files to load, as Vite does", "production")
    .option("--guild <id>", "send every Command to this one guild instead", guildId)
    .addOption(new Option("--dry-run", "only show the plan").conflicts(["check", "yes"]))
    .addOption(new Option("--check", "only show the plan; exit 2 when Discord is out of date (for CI)").conflicts("yes"))
    .option("-y, --yes", "apply without asking (required when not in a terminal)")
    .addHelpText("after", ENV_HELP)
    .action(async (options: SyncOptions) => {
      status = await sync(options, io)
    })

  try {
    await program.parseAsync(argv, { from: "user" })
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode
    throw error
  }
  return status
}

/** `composure sync`. */
export async function sync(options: SyncOptions, io: Io): Promise<number> {
  const { ui } = io
  ui.intro("composure sync")
  try {
    const root = resolve(options.root)
    const config = configFromEnv(io.readEnvFiles === false ? io.env : projectEnv(root, options.mode, io.env))
    if (options.guild) config.guild = options.guild
    const entry = options.app ?? defaultEntry(root)
    const rest = io.transport ? { transport: io.transport } : {}

    const definitions = await ui.step(
      `Loading ${entry}`,
      async () => (await loadApp(root, entry)).definitions(),
      (d) => `Loaded ${entry}: ${d.length} Command${d.length === 1 ? "" : "s"}`,
    )
    const where = config.guild ? `guild ${config.guild}` : "Discord"
    const planned = await ui.step(`Comparing with ${where}`, () => plan(definitions, config, rest), summary)
    ui.note(formatPlan(planned, ui.style), "Sync Plan")

    if (!hasChanges(planned)) {
      ui.outro("Nothing to sync.")
      return 0
    }
    if (options.check) {
      ui.fail("Discord is out of date.")
      return 2
    }
    if (options.dryRun) {
      ui.outro("Dry run: nothing applied.")
      return 0
    }
    const n = counts(planned)
    const total = n.create + n.update + n.delete
    if (!options.yes) {
      if (!ui.confirm) {
        ui.fail("Not applied: pass --yes to apply without a terminal, or --dry-run / --check to only show the plan.")
        return 1
      }
      if (n.delete > 0) ui.warn(`${n.delete} Command${n.delete === 1 ? "" : "s"} will be deleted from Discord.`)
      if (!(await ui.confirm(`Apply ${total} change${total === 1 ? "" : "s"}?`))) {
        ui.fail("Cancelled.")
        return 1
      }
    }
    await ui.step(
      "Syncing",
      () => apply(planned, config, rest),
      () => `Synced ${total} change${total === 1 ? "" : "s"}`,
    )
    ui.outro("Discord is up to date.")
    return 0
  } catch (error) {
    ui.fail(error instanceof SyncError ? error.message : `Sync failed: ${(error as Error).stack ?? String(error)}`)
    return 1
  }
}

/** The process env over the root's .env files for the mode, as Vite loads them (ADR 0031). */
function projectEnv(root: string, mode: string, env: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...loadEnv(mode, root, ""), ...env }
}
