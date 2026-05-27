# ForgeGate installation & adoption

Make ForgeGate's local/global install boring and trustworthy, then keep the public GitHub install path
accurate. Design rationale and lane breakdown live in [`docs/install-adoption-design.md`](../../install-adoption-design.md).

- **Goal:** close the install-drift gap — give the operator a reliable way to confirm that the installed
  Claude commands/agent charters match the current ForgeGate checkout, and make the install/update loop
  self-verifying.
- **Non-goals (this epic):** hooks, plugin packaging, installer scripts, `init-target`, a `doctor` command,
  status write-back, journal automation, and any auto commit/push/PR/merge. Those stay deferred.
- **Constraints:** human-gated; one ticket at a time; the run always stops at the commit gate; the engineer
  edits only a ticket's `allowed_paths`.

## Sprints

- `sprint-01-verify-install` — add the read-only `forge verify-install` install-currency check (T01).

> Self-run note: this epic modifies ForgeGate's own CLI, so its tickets are driven with a **frozen build**
> (`pnpm build` then `FORGE_BIN="node <repo>/dist/cli.js"`) so a run cannot mutate the tool executing it.
