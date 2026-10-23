---
"composurejs": minor
---

A click runs the middleware of the Command that rendered its handler (its Owning Route), so a guard
on a nested App also guards that Command's buttons, and the buttons they render. The route travels
in the `custom_id` (6 characters); a Command that no longer exists gets the Fallback. Also
`Permission` flags, `c.can(...)` and `c.appCan(...)`, and `appPermissions()` on test builders.
