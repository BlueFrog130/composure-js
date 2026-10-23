---
"@composurejs/vite": minor
"@composurejs/cli": patch
"create-composurejs": patch
---

The Handler Lock: `vite build` writes `composure.handlers.json` (every handler id, where it is and
what it captures) and warns when a change would drop one or change a `named()` handler's captures,
turning buttons already sent into "This message is outdated."; with `CI` set it fails instead.
`vite dev` warns as you edit. `composure({ handlerLock: false })` turns it off.
