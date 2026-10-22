// `vite -c vite.node.config.ts`: the Dev Loop (serve, tunnel, dev Sync).
// `vite build -c vite.node.config.ts` → dist/node/index.js, self-contained: `node dist/node/index.js`.
import composure from "@composurejs/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [composure({ target: "node", entry: "src/node.ts", outDir: "dist/node" })],
})
