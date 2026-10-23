// `vite build` → a Worker in dist/, deployed with `wrangler deploy`; `vite dev` runs it on workerd,
// with the Dev Loop's tunnel and dev Sync.
import { cloudflare } from "@cloudflare/vite-plugin"
import composure from "@composurejs/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    composure({
      dev: {
        // Your Dev Application's id: `vite dev` points its Interactions Endpoint URL at the tunnel
        // (only when DISCORD_TOKEN in .env.local is its token). Unset: the URL is printed.
        // application: "",
        // Your test server's id: Commands are synced there on start and on every change.
        // guild: "",
        tunnel: "quick",
      },
    }),
    cloudflare(),
  ],
  // Bundle size is cold-start time on Workers.
  build: { minify: true },
})
