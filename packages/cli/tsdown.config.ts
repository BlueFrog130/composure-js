import { defineConfig } from "tsdown"

export default defineConfig({
  entry: { index: "src/index.ts", bin: "src/bin.ts" },
  format: "esm",
  platform: "node",
  fixedExtension: false,
  dts: { tsconfig: "tsconfig.build.json" },
  external: [/^composurejs/, /^@composurejs\//, "vite", /^discord-api-types/],
})
