import { defaultServerConditions } from "vite"
import { defineProject } from "vitest/config"
// A bot imports this as "@composurejs/vite"; here it is the workspace source, so tests need no build.
import composure from "../vite/src/index.ts"

export default defineProject({
  plugins: [composure()],
  // Resolve workspace packages to their TypeScript source, not dist.
  ssr: { resolve: { conditions: ["@composurejs/source", ...defaultServerConditions] } },
  test: {
    name: "composurejs",
  },
})
