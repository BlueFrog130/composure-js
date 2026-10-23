// Generates every create-composurejs template, links it to this workspace's packages, installs,
// and runs its typecheck, tests and build: what a new user gets must work (composure-rs's
// scripts/check-templates.sh). Run after `pnpm build`:  node scripts/check-templates.mjs [template..]
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generate, TEMPLATES } from "../packages/create-composurejs/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, ".tmp", "templates");
const only = process.argv.slice(2);
const templates = Object.keys(TEMPLATES).filter((t) => only.length === 0 || only.includes(t));

rmSync(out, { recursive: true, force: true });
let failed = 0;
for (const template of templates) {
  const dir = join(out, template);
  const link = (pkg) => `link:${relative(dir, join(root, "packages", pkg)).replace(/\\/g, "/")}`;
  const files = generate(template, `check-${template}`, {
    composurejs: link("composurejs"),
    cli: link("cli"),
    vitePlugin: link("vite"),
    vite: "^8.3.5",
  });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  // A standalone project, not part of this workspace.
  writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages: []\nallowBuilds:\n  esbuild: true\n  workerd: true\n");
  console.log(`\n== ${template}`);
  try {
    for (const step of ["pnpm install --no-frozen-lockfile", "pnpm typecheck", "pnpm test", "pnpm build"]) {
      console.log(`$ ${step}`);
      execSync(step, { cwd: dir, stdio: "inherit", env: { ...process.env, CI: "1" } });
    }
  } catch {
    failed++;
    console.error(`!! ${template} failed`);
  }
}
if (failed > 0) {
  console.error(`\n${failed} of ${templates.length} templates failed`);
  process.exit(1);
}
console.log(`\nAll ${templates.length} templates install, typecheck, test and build.`);
