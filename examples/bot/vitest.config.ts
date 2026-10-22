import { defaultServerConditions } from "vite"
import { defineProject } from "vitest/config"

export default defineProject({
  ssr: { resolve: { conditions: ["@composurejs/source", ...defaultServerConditions] } },
  test: {
    name: "example-bot",
  },
})
