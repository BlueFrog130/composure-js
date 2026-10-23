---
"composurejs": minor
"@composurejs/vite": minor
"@composurejs/cli": minor
"@composurejs/eslint-plugin": minor
"create-composurejs": minor
---

Bots need Node 22.12+ (`server()` builds for `node22`). `composurejs` is a peer dependency of
`@composurejs/vite` and `@composurejs/eslint-plugin`, so a bot has one copy. Autocomplete cuts
over-long Choice names and drops invalid Choices instead of failing. `composurejs/testing`'s
`command("name")` is now `chatInput("name")`, so it no longer clashes with `command` from core.
