// Refreshes the vendored OpenAPI spec and the REST types generated from it.
//   node scripts/update-spec.mjs [commit]   (default: discord/discord-api-spec main)
// Then run the tests: test/rest-spec.test.ts checks every Endpoint against the new spec.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const repo = "discord/discord-api-spec";
const sha = process.argv[2] ?? (await (await fetch(`https://api.github.com/repos/${repo}/commits/main`)).json()).sha;
const spec = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/specs/openapi.json`);
if (!spec.ok) throw new Error(`Fetching the spec at ${sha} failed: ${spec.status}`);
writeFileSync(new URL("../spec/openapi.json", import.meta.url), await spec.text());
writeFileSync(new URL("../spec/PINNED", import.meta.url), `${sha}\n`);

// openapi-typescript needs the TypeScript 5 compiler API, which TypeScript 7 does not ship.
execFileSync("pnpm", ["dlx", "--package=openapi-typescript@7.13.0", "--package=typescript@5.9.3", "openapi-typescript", "spec/openapi.json", "-o", "src/rest/schema.d.ts"], {
  cwd: new URL("..", import.meta.url),
  stdio: "inherit",
  shell: process.platform === "win32",
});
console.log(`Pinned ${repo}@${sha}`);
