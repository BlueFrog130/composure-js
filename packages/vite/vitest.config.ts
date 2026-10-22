import { defaultServerConditions } from "vite"
import { defineProject } from "vitest/config"

export default defineProject({
  ssr: { resolve: { conditions: ["@composurejs/source", ...defaultServerConditions] } },
  test: {
    name: "vite",
    // The dev tests start real servers and watch files: keep them in one worker.
    fileParallelism: false,
  },
})
