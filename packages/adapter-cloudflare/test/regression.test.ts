import { env, regressionApp, replayFixtures } from "../../composurejs/test/replay.ts"
import { handle } from "../src/index.ts"

replayFixtures("cloudflare", (request) => handle(regressionApp).fetch(request, env, { waitUntil() {} }))
