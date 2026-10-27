---
"composurejs": minor
"@composurejs/vite": minor
"@composurejs/eslint-plugin": minor
---

The placement check follows function components: a tag passed to one is checked against the parent it puts its children in (`<Button> cannot go inside <Container> (in <ui.Primary>)`), and what one renders against where it is placed (`(rendered by <Card>)`). Function components are followed in the module and through relative imports and re-exports; `checkPlacement` takes `{ file, load }` for the latter. The lint rule reads imported modules from disk (`@composurejs/eslint-plugin` now depends on `oxc-parser`), and `vite dev` re-checks a module when one it followed changes.
