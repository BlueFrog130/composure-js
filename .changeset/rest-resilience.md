---
"composurejs": minor
---

REST requests time out after 10 s (`RequestTimeoutError`; `requestTimeout` on the App, `timeout` on
a client), retry twice on network errors, timeouts and 5xx unless they are POSTs, and wait for a
used-up rate limit bucket before sending instead of only reacting to 429s. `MockTransport` can
`fail()` and `hang()`. The User-Agent names the package version.
