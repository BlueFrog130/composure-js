import { defaultServerConditions } from "vite"
import { defineProject } from "vitest/config"
// In your bot: import composure from "@composurejs/vite"
import composure from "../../packages/vite/src/index.ts"

export default defineProject({
  plugins: [composure()],
  ssr: { resolve: { conditions: ["@composurejs/source", ...defaultServerConditions] } },
  test: {
    name: "example-bot",
  },
})
