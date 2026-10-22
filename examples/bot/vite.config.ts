// `vite build` → a Worker in dist/, deployed with `wrangler deploy`; `vite dev` runs it on workerd.
import { cloudflare } from "@cloudflare/vite-plugin"
import composure from "@composurejs/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [composure({ target: "cloudflare" }), cloudflare()],
})
