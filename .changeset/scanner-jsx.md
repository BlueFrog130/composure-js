---
"@composurejs/vite": patch
---

`composure()` names composurejs as the dep scanner's JSX runtime: a `.tsx` module with `import.meta.glob` no longer fails `vite dev`'s dependency scan on `react/jsx-dev-runtime`.
