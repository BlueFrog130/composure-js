import { defineConfig } from "tsdown"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "jsx-runtime": "src/jsx-runtime.ts",
    "jsx-dev-runtime": "src/jsx-dev-runtime.ts",
    components: "src/components.ts",
    placement: "src/placement.ts",
    "rest/index": "src/rest/index.ts",
    sync: "src/sync.ts",
    "testing/index": "src/testing/index.ts",
  },
  format: "esm",
  platform: "neutral",
  dts: { tsconfig: "tsconfig.build.json" },
  external: [/^node:/, /^discord-api-types/],
})
