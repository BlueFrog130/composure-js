---
"composurejs": minor
"@composurejs/vite": minor
---

`onClick` / `onSelect` / `onSubmit` accept more: each function branch of `?:`, `&&`, `||` and `??`
is hoisted, a module-level or imported function becomes a handler, and wrapper components can pass a
handler prop on (`({ onClick }) => <Button onClick={onClick} />`). Local variables and calls are
compile errors, and render's error for an uncompiled function names both causes.
