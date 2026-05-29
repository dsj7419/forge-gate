# Sprint 01 — decisions-ledger sequence integrity

One ticket: add a two-layer sequence-integrity invariant to the per-epic decisions ledger
(`src/orchestrator/decisions-ledger.ts`). The read layer makes `DecisionsLedgerSchema` reject a ledger
whose decision IDs repeat or run out of order (strictly increasing by numeric value; gaps tolerated on
read). The append layer makes `appendDecision` reject any new ID that is not exactly
`nextDecisionId(existing)`, with no write on failure. Colocated tests cover both layers and the
per-attempt `D-001` reuse compatibility.

**Done means:** T01's Acceptance Criteria are met, both verifiers APPROVE, `pnpm test` + `pnpm
typecheck` are green, and the run stops at the commit gate for a human.

**Halt-triggers:** any change outside T01's `allowed_paths`; any change to
`src/orchestrator/decision-id.ts` or its test (the allocator stays as-is — it is only imported); any
change to `src/orchestrator/dispatch.ts` / `packets.ts`, `src/cli/**`, `src/run-report/**`,
`src/agents/**`, `src/guard/**`, `src/validate/**`, `src/install/**`, `src/schema/**`, `commands/**`,
`agents/**`, or `README.md`; any addition of `run_id`, `attempt_id`, status write-back, journal
automation, hooks, or multi-ticket behavior; a failing verify command after the correction cap.
