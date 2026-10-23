# Bundle size is a CI budget; cold start is a benchmark

Bundle size and cold start are features on Workers (kickoff brief, lesson 16). Size is cheap to measure exactly, so it gates CI. `.size-limit.json` bundles what a bot imports with esbuild (minified, brotli) and fails `pnpm size` when one grows past its limit, set about 10% above its size when the budget was introduced:

| Entry | Size | Limit |
|---|---|---|
| core: `App`, `command` | 13.5 kB | 15 kB |
| core + Views (tags, JSX runtime) | 13.6 kB | 15 kB |
| `composurejs/rest`: `createMessage` | 5.8 kB | 6.5 kB |
| the example bot's Worker (`vite build`) | 16.2 kB | 18 kB |

Raised before the first release, when CI first ran: core had grown to 17.6 kB and the example Worker to 20.4 kB through Owning Routes, Auto Defer, Forms, Localizations, REST resilience and structured logging, each landed without CI. The limits were reset about 10% above those sizes: 19.5 kB for both core entries and 22.5 kB for the Worker; `composurejs/rest` kept 6.5 kB (6.4 kB).

Core is most of any bot, since `App.fetch` reaches the pipeline and the render walk. Raising a limit is a decision for the commit that needs it, not a default. Cold start depends on the machine, so it is measured, not gated. `examples/bot/scripts/coldstart.mjs` runs the built Worker on workerd (Miniflare) next to an empty JS Worker that also reads the request body, since an unread body stalls the connection and skews the comparison. It reports the medians of startup, the first request (a signed PING: key import and Ed25519 verify), the first Command and warm Commands, and the difference is what composurejs costs. One discarded run warms the process, and the Workers alternate which runs first. When the budget was introduced, composurejs added about 1 ms to startup and to the first request, 2 ms to the first Command, and 0.25 ms warm. CI runs it as a report (`continue-on-error`) so regressions are visible in the log without flaky failures.
