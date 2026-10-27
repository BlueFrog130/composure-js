---
"composurejs": minor
"@composurejs/vite": minor
---

A local function is now an Inline Handler: `const add = (c) => ..` (or `function add(c) {..}`) in a component, named by `onClick` / `onSelect` / `onSubmit`, is hoisted with what it captures and stays callable. A hoisted handler that reads a function declared inside a function is now a compile error naming it, instead of failing at render.
