---
"composurejs": minor
---

Forms: `form({ mood: field.radio(Mood, { label }), stars: field.integer({ label, min, max }) })` and
`<Modal form={f} values={..} onSubmit={(c, v) => ..}>` render a modal from typed Fields and give
`onSubmit` typed, parsed values. A select's `options` type `onSelect`'s values.
`modalSubmit(..).users(..)` / `.roles(..)` in `composurejs/testing`; `res.submit()` finds inputs by name.
