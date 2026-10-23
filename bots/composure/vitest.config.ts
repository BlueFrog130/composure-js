import { defaultServerConditions } from "vite";
import { defineProject } from "vitest/config";
import composure from "../../packages/vite/src/index.ts";

export default defineProject({
  plugins: [composure()],
  ssr: { resolve: { conditions: ["@composurejs/source", ...defaultServerConditions] } },
  test: {
    name: "bot",
  },
});
