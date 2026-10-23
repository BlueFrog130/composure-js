#!/usr/bin/env node
// The `composure` executable.
import { main } from "./cli.ts";
import { clackUi } from "./ui.ts";

process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  ui: clackUi({ interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) }),
  out: (text) => console.log(text),
  err: (text) => console.error(text),
});
