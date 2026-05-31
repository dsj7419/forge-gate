# Sprint 01 — Core-owned decision-id provenance

**Epic:** forge-decision-id-provenance
**Status:** active
**Integration base:** main

## Goal

Close both decision-id seams: Core assigns the PM `decision_id` during `forge dispatch pm`, and a new
`forge ledger append` command records the accepted decision through `appendDecision` — putting C4's
exact-next monotonicity guard on the live path and removing the orchestrator's hand-authored ledger JSON.

## Tickets

- **T01** — Move PM decision-id assignment and ledger append onto Core.

## Halt-triggers

Any change outside T01's `allowed_paths`; any edit to `src/orchestrator/decision-id.ts` or
`src/orchestrator/decisions-ledger.ts` logic (frozen — wire, do not change); any run-report change
(`src/run-report/**`); any change to `parse-agent pm` cross-check semantics; any command-markdown
(`commands/**`) or charter (`agents/**`) edit; any loosening of `DecisionsLedgerSchema`; a failing verify
command after the correction cap.
