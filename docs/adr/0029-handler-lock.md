# The Handler Lock: committed handler ids, checked by the build

Builds on [ADR 0015](./0015-inline-handlers-everywhere.md), whose generated Handler Ids change when a handler moves, its owner is renamed, handlers are reordered, or it captures something new.

Each such change is safe in itself: old buttons get the Fallback, never the wrong handler. But it is silent. A refactor ships, and every button already sent answers "This message is outdated."; the author learns that `named()` existed after the users do. Nothing in a code review shows it, because the ids are derived.

**What.** `composure()` records, during `vite build`, every handler each module ships: its id, where it is (`file: owner`), and its captured paths. The build compares that with `composure.handlers.json` at the Vite root, which the bot commits:

- No file: a local build writes it; in CI the build warns that it is missing.
- A local build that drops an id, or changes an id's captures (only possible for `named()` ids, since generated ids hash their captures), warns with one line per handler and rewrites the file, so the change shows in the diff a reviewer reads.
- With `CI` set, the build never writes; a dropped or changed id fails it, naming each handler and the two ways out (commit the updated lock if intended, or `named()`). New ids only warn that the lock is stale.
- `vite dev` warns when an edit drops a locked handler from the module being transformed. Vitest runs, and the plugin instances `composure sync` and dev Sync load the App with, never touch it.
- `composure({ handlerLock: false })` turns it off.

The file is JSON sorted by id, compared by content (so a formatter laying it out differently does not cause a rewrite). Environments that transform no handlers (a client build next to the Worker) are ignored, since they say nothing about the App.

**Rejected.** Comparing against the previous deploy's build output: CI rarely has it, and it cannot be reviewed. A separate `composure check` command only: the build already knows every id, and a check that people must remember to run is the problem again. Failing local builds too: a refactor in progress would be blocked on every build, and the rewritten file already puts the decision in front of the reviewer. More stable generated ids (dropping position from the hash): narrower breakage, still silent, and swapping two handlers would then misroute.
