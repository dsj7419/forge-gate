# Sprint 01 — Orchestrator lock wiring

One ticket: wire `commands/forge-run-ticket.md` to call the shipped `forge lock acquire | release | status`
surface instead of hand-managing `$EPIC/.forge/lock.json`. Acquire is atomic and happens before active-ticket
emission and branch creation; release is owner-checked (`--run-id`) on PASS and ESCALATE; the lock is held across
CORRECT cycles; nothing force-breaks or steals a lock.

- **T01** — Wire the orchestrator command to `forge lock` (acquire-before-emission, owner-checked release,
  hold-on-CORRECT, fail-closed, no force-break).

Acceptance evidence is a **non-tautological protocol-lock test** (extending
`src/commands/forge-run-ticket-protocol.test.ts`) that asserts the new lock-wiring instructions are present *and*
the old hand-rolled check-then-write/hand-release pattern is gone, plus a manual reasoning walkthrough of the
PM-required proof points through the edited command text. No orchestrator is executed against the live repo; no
real lock is taken; no destructive operation is run. `pnpm test` + `pnpm typecheck` stay green.
