# Sprint 01 — Workflow lock wiring

One ticket: wire `workflows/forge-run-ticket.workflow.js` to the shipped `forge lock acquire | release` surface
(through the existing `forge-core-runner` bridge), replacing the non-atomic `test -f lock.json` /
`PREFLIGHT_LOCK_EXISTS` check-then-act probe with an atomic acquire in preflight, and adding an owner-checked
release on the PASS and ownership-known terminal paths. The lock is held across the correction loop; nothing
force-breaks or steals a lock.

- **T01** — Wire the workflow-backed runner to `forge lock` (atomic acquire in preflight before checkpoint /
  active-ticket / dispatch; owner-checked release on PASS + terminal; hold-across-CORRECT; fail-closed; no
  force-break).

Acceptance evidence is a **non-tautological protocol-lock test** against the workflow source (present new
`forge lock` wiring + ordering + release-on-both-terminals; absent the old `test -f` lock probe and
`PREFLIGHT_LOCK_EXISTS`) plus a manual execution-trace review. No live workflow is executed and no real lock is
taken; the first live proof is a later governed workflow run. `pnpm test` + `pnpm typecheck` stay green.
