#!/usr/bin/env node
// The `create-composurejs` executable: `pnpm create composurejs [dir]`.
import cli from "../../cli/package.json" with { type: "json" }
import core from "../../composurejs/package.json" with { type: "json" }
import vitePlugin from "../../vite/package.json" with { type: "json" }
import { install, main } from "./create.ts"

// Bundled at build time, so a release scaffolds the versions it was released with.
const versions = {
  composurejs: `^${core.version}`,
  cli: `^${cli.version}`,
  vitePlugin: `^${vitePlugin.version}`,
  vite: "^8.3.5",
}

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  userAgent: process.env.npm_config_user_agent,
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  versions,
  install,
  out: (text) => console.log(text),
  err: (text) => console.error(text),
})
