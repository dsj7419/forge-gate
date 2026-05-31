# Epic — Core-owned PM decision-id assignment and ledger append

**Status:** active
**Integration base:** main

## Why

Discovery (`docs/b2-decision-id-assignment-discovery.md`) found that C4's ledger logic
(`nextDecisionId`, `appendDecision`, the uniqueness/monotonicity `superRefine`) exists and is tested, but
**no CLI command calls it** — `src/cli/run.ts` imports none of the ledger modules. On a live run the
orchestrator markdown reads the ledger, computes the next id in prose, and **hand-writes the JSON append**.
So C4's exact-next guard is correct code sitting *off* the live enforcement path — the same
"orchestrator hand-authors a Core artifact" seam just hardened for agent-output capture.

This epic closes both decision-id seams so the path matches ForgeGate doctrine — **Core assigns the
authoritative field, the agent echoes it, Core validates the echo, Core records the decision**:

1. **Assignment** — `forge dispatch pm` reads `<epic>/.forge/decisions-ledger.json` through Core, computes
   the next monotonic id with `nextDecisionId`, and renders it into the PM prompt. `--assigned-decision-id`
   downgrades to an optional cross-check (mismatch → `DECISION_ID_PROVENANCE_MISMATCH`), never the source.
2. **Append** — a new explicit Core command `forge ledger append` writes the accepted PM decision via the
   existing `appendDecision`, putting C4's `LEDGER_SEQUENCE_INVALID` guard on the live path and removing the
   hand-authored ledger JSON.

## What (Option B)

- Move PM `decision_id` assignment into `forge dispatch pm` (Core reads ledger + `nextDecisionId`,
  CLI-layer IO, keeping `buildPmDispatch` pure).
- Add `forge ledger append <epic> --decision-id --ticket --branch` (Core-generated `ts`; calls
  `appendDecision`).
- `parse-agent pm --expected-decision-id` and the run-report are unchanged.

## Out of scope

- Editing `commands/forge-run-ticket.md` — just hardened + installed; prose cleanup is a later doc-only
  follow-up.
- Changing `nextDecisionId` semantics or `DecisionsLedgerSchema` (frozen; this epic *wires* them).
- Any run-report schema / assembler / CLI change (`decision_id` still comes verbatim from PM output).
- The workflow runner, Phase 1c, Option B-for-capture, or the PowerShell-through-Bash subagent tool-policy
  gap (a separate FOLLOW_UP_OK / security-process item, not part of this epic).

## Sprints

- **sprint-01-decision-id-provenance** — T01: move PM decision-id assignment and ledger append onto Core.
