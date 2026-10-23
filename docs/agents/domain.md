# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout: single-context

This repo's glossary is **`CONTEXT.md`** at the root (it plays the role the skills call `GLOSSARY.md`). Decisions are ADRs in **`docs/adr/`** (`NNNN-*.md`). One glossary covers every package in the workspace.

```
/
├── CONTEXT.md        ← the glossary
├── docs/adr/
│   ├── 0001-*.md
│   └── ...
└── packages/
```

When a skill says `GLOSSARY.md`, read and write `CONTEXT.md`. Never create a `GLOSSARY.md` or `GLOSSARY-MAP.md`.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms it lists under _Avoid_.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0017 (Dev Loop), but worth reopening because…_

A decision that replaces an ADR gets a new ADR that says which one it supersedes.
