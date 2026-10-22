import { env, regressionApp, replayFixtures } from "../../composurejs/test/replay.ts"
import { handle } from "../src/index.ts"

replayFixtures("bun", (request) => handle(regressionApp, { env, handleSignals: false }).fetch(request))
