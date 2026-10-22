import { defaultServerConditions } from "vite"
import { defineProject } from "vitest/config"
import composure from "./src/index.ts"

export default defineProject({
  // The signed fixtures the Default Server replays use Inline Handlers.
  plugins: [composure({ placement: false })],
  ssr: { resolve: { conditions: ["@composurejs/source", ...defaultServerConditions] } },
  test: {
    name: "vite",
    // The dev tests start real servers and watch files: keep them in one worker.
    fileParallelism: false,
  },
})
