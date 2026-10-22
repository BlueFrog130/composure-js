---
"composurejs": minor
---

Auto Defer: a Command, click or modal submit whose handler has not answered 2 seconds after the
request arrived is deferred for it, and the answer is edited in when it comes. `autoDefer: { after }`
or `false` on the App; `autoDefer: false | "ephemeral"` on each Command.
