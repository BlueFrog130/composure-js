// `vite -c vite.node.config.ts`: the Dev Loop (serve, tunnel, dev Sync).
// `vite build -c vite.node.config.ts` → dist/node/index.js, the Default Server around src/app.tsx,
// self-contained: `node dist/node/index.js`.
import composure from "@composurejs/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [composure({ target: "node", outDir: "dist/node" })],
})
