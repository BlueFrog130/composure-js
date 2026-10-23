---
"composurejs": patch
---

Core fixes from a review: a middleware that calls `next()` without awaiting it no longer leaves an
unhandled rejection (fatal on Node); an App changed after a parent App was built is seen by the
parent; `DiscordApiError` messages list Discord's per-field errors (`components[0].label: This field
is required (BASE_TYPE_REQUIRED)`) and logged errors keep their own fields (`status`, `code`,
`errors`); render errors about a `custom_id` name only its handler id, never its captured values.
