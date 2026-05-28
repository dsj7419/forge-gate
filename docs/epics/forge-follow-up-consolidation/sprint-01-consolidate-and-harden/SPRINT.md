# Sprint 01 — Consolidate post-PR follow-ups and precision hardening

One ticket: retire the four recorded FOLLOW_UP_OK items in a single pass — drop the dead
`SAFETY_INVARIANT_VIOLATION` union member; extend `OrchestratorConfirmedFactsSchema` with a
`pm: boolean` field that the assembler reads instead of hard-coding; harden `renderContext` to
fail when a PM packet has a null `assigned_decision_id`; correct the v1 write-enumeration
parenthetical in `commands/forge-run-ticket.md` and `README.md` so it includes
`decisions-ledger.json`.

**Done means:** T01's Acceptance Criteria are met, both verifiers APPROVE, `pnpm test` + `pnpm
typecheck` are green, and the run stops at the commit gate for a human.

**Halt-triggers:** any change outside T01's `allowed_paths`; any change to
`src/agents/parse-output.ts` / `src/agents/schemas.ts` / `src/agents/index.ts`; any change to
`src/run-report/schema.ts` (the v1 artifact stays stable) or `src/run-report/schema.test.ts`; any
change to `src/orchestrator/decision-id.ts`, `decisions-ledger.ts`, or their tests (those modules
are done); any addition of `run_id`, `attempt_id`, status write-back, journal automation, hooks,
or multi-ticket behavior; a failing verify command after the correction cap.
