import { defaultServerConditions } from "vite"
import { defineProject } from "vitest/config"

export default defineProject({
  // Resolve workspace packages to their TypeScript source, not dist.
  ssr: { resolve: { conditions: ["@composurejs/source", ...defaultServerConditions] } },
  test: {
    name: "composurejs",
  },
})
