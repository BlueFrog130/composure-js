// `vite build -c vite.bun.config.ts` → dist/bun/index.js, the Default Server around src/app.tsx:
// `bun dist/bun/index.js`.
import composure from "@composurejs/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [composure({ target: "bun", outDir: "dist/bun" })],
})
