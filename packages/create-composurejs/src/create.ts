// `pnpm create composurejs [dir]`: asks what it needs (commander flags skip the questions), writes
// the template, installs.
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import { cancel, confirm, intro, isCancel, log, note, outro, select, spinner, text } from "@clack/prompts"
import { Command, CommanderError, Option } from "commander"
import pkg from "../package.json" with { type: "json" }
import { generate, type Template, TEMPLATES, type Versions } from "./templates.ts"

export interface CreateOptions {
  template?: Template
  install?: boolean
  yes?: boolean
}

/** What the CLI does with the world: replaced in tests. */
export interface Env {
  cwd: string
  /** `npm_config_user_agent`: which package manager ran us. */
  userAgent: string | undefined
  interactive: boolean
  versions: Versions
  install(dir: string, packageManager: string): Promise<boolean>
  out(text: string): void
  err(text: string): void
}

const NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

/** Runs the CLI; resolves to the exit status. */
export async function main(argv: string[], env: Env): Promise<number> {
  let status = 0
  const program = new Command("create-composurejs")
    .description("Create a composurejs Discord bot")
    .version(pkg.version, "-v, --version")
    .argument("[dir]", "directory to create the bot in")
    .addOption(new Option("-t, --template <template>", "the platform").choices(Object.keys(TEMPLATES)))
    .option("--no-install", "skip installing dependencies")
    .option("-y, --yes", "use the defaults for anything not given")
    .exitOverride()
    .configureOutput({ writeOut: (t) => env.out(t.trimEnd()), writeErr: (t) => env.err(t.trimEnd()) })
    .action(async (dir: string | undefined, options: CreateOptions) => {
      status = await create(dir, options, env)
    })
  try {
    await program.parseAsync(argv, { from: "user" })
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode
    throw error
  }
  return status
}

async function create(dirArg: string | undefined, options: CreateOptions, env: Env): Promise<number> {
  intro("create-composurejs")
  const ask = env.interactive && !options.yes
  const stop = (message: string) => (cancel(message), 1)

  let dir = dirArg
  if (!dir) {
    if (!ask) dir = "my-bot"
    else {
      const answer = await text({ message: "Where should the bot go?", placeholder: "my-bot", defaultValue: "my-bot" })
      if (isCancel(answer)) return stop("Cancelled.")
      dir = answer
    }
  }
  const target = resolve(env.cwd, dir)
  const name = basename(target).toLowerCase().replace(/[^a-z0-9-._~]/g, "-")
  if (!NAME.test(name)) return stop(`"${name}" is not a valid package name`)
  if (existsSync(target) && readdirSync(target).length > 0) {
    if (!ask) return stop(`${dir} is not empty`)
    const go = await confirm({ message: `${dir} is not empty. Write into it anyway?`, initialValue: false })
    if (isCancel(go) || !go) return stop("Cancelled.")
  }

  let template = options.template
  if (!template) {
    if (!ask) template = "cloudflare"
    else {
      const answer = await select({
        message: "Where will it run?",
        options: (Object.entries(TEMPLATES) as [Template, (typeof TEMPLATES)[Template]][]).map(([value, { label, hint }]) => ({ value, label, hint })),
      })
      if (isCancel(answer)) return stop("Cancelled.")
      template = answer
    }
  }

  const files = generate(template, name, env.versions)
  for (const [path, content] of Object.entries(files)) {
    const file = join(target, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  log.success(`Created ${name} for ${TEMPLATES[template].label} in ${relative(env.cwd, target) || "."}`)

  const pm = env.userAgent?.split("/")[0] ?? "npm"
  let install = options.install !== false
  if (install && ask) {
    const answer = await confirm({ message: `Install dependencies with ${pm}?`, initialValue: true })
    if (isCancel(answer)) return stop("Cancelled.")
    install = answer
  }
  if (install) {
    const s = spinner()
    s.start(`Installing with ${pm}`)
    const ok = await env.install(target, pm)
    if (ok) s.stop("Installed")
    else s.error(`${pm} install failed; run it yourself in ${dir}`)
  }

  const run = pm === "npm" ? "npm run" : pm
  const cd = relative(env.cwd, target)
  note(
    [
      ...(cd ? [`cd ${cd}`] : []),
      ...(install ? [] : [`${pm} install`]),
      "cp .env.example .env    # then fill it in",
      `${run} dev              # tunnel, dev Sync, and the bot`,
    ].join("\n"),
    "Next steps",
  )
  outro("Happy hacking!")
  return 0
}

/** Runs `<pm> install` in `dir`. */
export function install(dir: string, packageManager: string): Promise<boolean> {
  return new Promise((done) => {
    const child = spawn(packageManager, ["install"], { cwd: dir, stdio: "ignore", shell: process.platform === "win32" })
    child.on("close", (code) => done(code === 0))
    child.on("error", () => done(false))
  })
}

