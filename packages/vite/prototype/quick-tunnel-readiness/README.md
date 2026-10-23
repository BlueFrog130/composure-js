# PROTOTYPE: quick tunnel readiness (throwaway)

The question was when a cloudflared quick tunnel is ready for Discord to accept it as the interactions endpoint. The answer is in [ADR 0031](../../../../docs/adr/0031-dev-loop-rebuilt.md). These scripts are the primary source and are not part of the package.

Both scripts take an env file with `DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY` and `COMPOSURE_DEV_APPLICATION_ID`. They refuse to run unless the token belongs to that application. They PATCH that application's interactions endpoint and restore the original afterwards. cloudflared must be on PATH.

- `node strategies.mjs <env> [runs]` starts PATCHing at one of three points: as soon as the URL is printed (`url`), at the first registered connection (`registered`), or once 1.1.1.1 DoH resolves the host and a probe returns 401 (`doh`). It retries every 3 s.
- `node authoritative.mjs <env> [runs]` waits for an A record from trycloudflare.com's authoritative nameservers, then for a 401 from a probe pinned to that IP, then PATCHes. It honours `retry_after` on 429.

Results (2026-10-23), in ms from spawn:

| Strategy | URL printed | Registered | Resolved | Accepted |
|---|---|---|---|---|
| url | 3765 | 4237 | – | never (180 s, 429s) |
| registered | 3682 | 4156 | – | never (180 s, 400s) |
| doh | 3292 | 3737 | 15159 (DoH) | 28706 |
| url | 3259 | 3658 | – | 30161 |
| registered | 3463 | 3828 | – | 27943 |
| doh | 3223 | 3733 | 64544 (DoH, own negative cache) | 65710 |
| authoritative | 3806 | 4641 | 6750 | 8538 (first PATCH) |
| authoritative | 3563 | 3933 | 6995 | 8100 (first PATCH) |
| authoritative | 2997 | 3428 | 5538 | 14602 (429 left over from the previous run) |
| authoritative | 3943 | 4429 | 5521 | 28849 (429 left over from the previous run) |
