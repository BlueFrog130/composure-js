// `vite build` → the production Worker in dist/ (.env.production picks wrangler.jsonc's env),
// deployed with `wrangler deploy`. `vite dev` runs the dev one on workerd with the Dev Loop.
// Secrets: the Dev Application's in .env.local, production's in .env.production.local.
import { execSync } from "node:child_process";
import { cloudflare } from "@cloudflare/vite-plugin";
import composure from "@composurejs/vite";
import { defineConfig } from "vite";

/** The short commit /about shows: CI's GITHUB_SHA, else git, else "unknown". */
function gitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  plugins: [
    composure({
      dev: {
        // The Dev Application (wrangler.jsonc's top-level DISCORD_APPLICATION_ID): the only one
        // `vite dev` repoints, and only with its own token in .env.local.
        application: "1100146565504565411",
        // TODO: the home server's id, for dev Sync.
        // guild: "",
        tunnel: "quick",
      },
    }),
    cloudflare(),
  ],
  define: { __GIT_SHA__: JSON.stringify(gitSha()) },
  // Bundle size is cold-start time on Workers.
  build: { minify: true },
});
