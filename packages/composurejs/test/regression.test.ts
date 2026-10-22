import { env, regressionApp, replayFixtures } from "./replay.ts"

// Core's entry point; each Adapter package replays the same fixtures over its own.
replayFixtures("app.fetch", (request) => regressionApp.fetch(request, env, { waitUntil() {} }))
