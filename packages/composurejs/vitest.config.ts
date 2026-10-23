import { defaultServerConditions } from "vite";
import { defineProject } from "vitest/config";
// A bot imports this as "@composurejs/vite"; here it is the workspace source, so tests need no build.
import composure from "../vite/src/index.ts";

export default defineProject({
  // render.test.tsx misplaces tags on purpose: the walk is what it tests.
  plugins: [composure({ placement: false })],
  // Resolve workspace packages to their TypeScript source, not dist.
  ssr: { resolve: { conditions: ["@composurejs/source", ...defaultServerConditions] } },
  test: {
    name: "composurejs",
  },
});
