import { defineConfig } from "tsdown"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "jsx-runtime": "src/jsx-runtime.ts",
    "jsx-dev-runtime": "src/jsx-dev-runtime.ts",
    components: "src/components.ts",
    "rest/index": "src/rest/index.ts",
    "testing/index": "src/testing/index.ts",
    "adapters/cloudflare": "src/adapters/cloudflare.ts",
    "adapters/node": "src/adapters/node.ts",
    "adapters/bun": "src/adapters/bun.ts",
  },
  format: "esm",
  platform: "neutral",
  dts: true,
  external: [/^node:/, /^discord-api-types/],
})
