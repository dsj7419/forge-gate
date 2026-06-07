# Epic — Workflow lock wiring: serialize the workflow-backed runner with the epic lock

## Why

Cross-run serialization is now closed for the **command** orchestrator: the Core lock primitive (PR #34), the
`forge lock` CLI surface (PR #36), and the live wiring of `commands/forge-run-ticket.md` (PR #38) make the epic
lock the primary cross-run serialization guarantee for `/forge-run-ticket`.

The **workflow-backed runner** (`workflows/forge-run-ticket.workflow.js`) is the **last material unserialized
path**. It is a second orchestrator: it drives the same engineer → verifiers → PM loop to a Core-owned commit-gate
handoff via the typed `forge-core-runner` bridge. Its preflight still uses the exact non-atomic *check-then-act*
that the command path just retired — a `test -f "$EPIC/.forge/lock.json"` existence probe that escalates
`PREFLIGHT_LOCK_EXISTS` if present (`workflows/forge-run-ticket.workflow.js:271-276`). Two workflow runs — or one
workflow run and one command run — on the same epic can both pass that probe before either writes, then both
proceed to dispatch, ledger append, and run-report. The command path is serialized; the workflow path can still
bypass it.

This epic wires the workflow runner to the **same shipped `forge lock` surface** the command orchestrator uses, so
the workflow cannot bypass command-orchestrator serialization. The workflow already reaches Core/git/fs only
through the typed `forge-core-runner` bridge (`runCore`/`runCoreJsonResult`), and it already runs mutating `forge`
CLI commands through that bridge (`forge ledger append`, `forge run-report write`). `forge lock acquire|release` is
the same class of call — so this is a wiring change inside the workflow script plus its proof, touching no Core, no
agent charter, and no command.

## Goal

Replace the workflow runner's non-atomic lock probe with an atomic `forge lock acquire` (run through the existing
`forge-core-runner` bridge), and add an owner-checked `forge lock release` on the terminal paths:

- **acquire** in preflight — after the clean-tree check, before checkpoint capture, before active-ticket emission,
  and before any agent dispatch — fail-closed on `LOCK_HELD` / `LOCK_MALFORMED` / any undecidable result (stop
  before mutation);
- **release** owner-checked by `run_id` on PASS (after ledger append + run-report write) and on the
  ownership-known ESCALATE / terminal-halt paths; **hold** across the correction loop; never force-break or steal.

The epic lock remains the **primary** cross-run serialization guarantee; the CAS ledger append remains
**defense-in-depth**. The lock primitive (`src/orchestrator/lock.ts`) and its CLI (`src/orchestrator/lock-cli.ts`)
are invoked, never edited.

## Sprints

- `sprint-01-workflow-lock-wiring` — one ticket: wire the workflow runner to `forge lock`, proven by a
  non-tautological protocol-lock test against the workflow source.

## Out of scope (this epic)

- Editing the command orchestrator (`commands/forge-run-ticket.md`) — already serialized (PR #38).
- Editing the `forge-core-runner` charter (`agents/forge-core-runner.md`) or any agent — `forge lock` is the same
  CLI class the bridge already runs, so no charter change is needed.
- Stale-recovery UX — any assisted or forced clearing of a stale or foreign lock. No force-break / stale-clear /
  foreign-clear is introduced.
- Evidence-write ownership / `run_id` artifact enforcement across run-report / active-ticket / orchestrator-facts.
- Worktree / shared-state architecture (the lock/ledger location remains caller-supplied per-epic `.forge`).
- Any change to the shipped lock primitive, the lock CLI, the ledger modules, the schema, or the CLI router.
- Status write-back; journal write; any outward action (the workflow already performs none).

## Carried-forward decisions (ratified)

1. The **epic lock is the primary cross-run serialization guarantee**; this slice extends it to the workflow path.
2. The **CAS ledger append remains defense-in-depth**.
3. The command orchestrator is already serialized (PR #38); the workflow runner is the last material unserialized path.
4. No stale-recovery UX; the workflow never force-breaks or steals a lock.
5. No evidence / `run_id` artifact-ownership enforcement (the `run_id` is the lock ownership key only).
6. No worktree / shared-state architecture work.
