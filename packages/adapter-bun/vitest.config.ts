import { defaultServerConditions } from "vite"
import { defineProject } from "vitest/config"
// The signed fixtures use Inline Handlers: compile them with the plugin's workspace source.
import composure from "../vite/src/index.ts"

export default defineProject({
  plugins: [composure()],
  // Resolve workspace packages to their TypeScript source, not dist.
  ssr: { resolve: { conditions: ["@composurejs/source", ...defaultServerConditions] } },
  test: {
    name: "adapter-bun",
  },
})
