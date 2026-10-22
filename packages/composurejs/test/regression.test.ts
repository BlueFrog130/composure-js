import { env, regressionApp, replayFixtures } from "./replay.ts"

// Core's entry point; packages/vite replays the same fixtures over the Default Server.
replayFixtures("app.fetch", (request) => regressionApp.fetch(request, env, { waitUntil() {} }))
