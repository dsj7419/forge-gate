# Sprint 01 — Core-assigned monotonic PM decision id

One ticket: introduce a Core-computed monotonic `decision_id` (sourced from a small per-epic ledger),
pin it in the PM dispatch packet, update the PM charter so the agent echoes the pinned value verbatim,
and have `parse-agent pm` cross-check the echo against an expected value.

**Done means:** T01's Acceptance Criteria are met, both verifiers APPROVE, `pnpm test` + `pnpm typecheck`
are green, and the run stops at the commit gate for a human.

**Halt-triggers:** any change outside T01's `allowed_paths`; any change that loosens
`src/agents/parse-output.ts` / `src/agents/schemas.ts` / `src/agents/index.ts` (Core stays strict — the
cross-check belongs in the CLI command layer, not in the validator); any write to `JOURNAL.md` or
`DECISIONS.md` or to a contract / manifest / governance file; a failing verify command after the
correction cap.
