// `vite build -c vite.bun.config.ts` → dist/bun/index.js: `bun dist/bun/index.js`.
import composure from "@composurejs/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [composure({ target: "bun", entry: "src/bun.ts", outDir: "dist/bun" })],
})
