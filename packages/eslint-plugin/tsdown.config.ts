import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  platform: "node",
  // .js/.d.ts, matching package.json exports (platform node defaults to .mjs).
  fixedExtension: false,
  dts: { tsconfig: "tsconfig.build.json" },
});
