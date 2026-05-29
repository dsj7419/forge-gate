---
schema_version: 1
id: T01
title: Harden decisions-ledger uniqueness and monotonicity
kind: green
risk: low
change_class: bugfix
blast_radius: local
status: pending
gate: pr
gate_override: false
allowed_paths:
  - "src/orchestrator/decisions-ledger.ts"
  - "src/orchestrator/decisions-ledger.test.ts"
forbidden_paths:
  - "src/orchestrator/decision-id.ts"
  - "src/orchestrator/decision-id.test.ts"
  - "src/orchestrator/dispatch.ts"
  - "src/orchestrator/dispatch.test.ts"
  - "src/orchestrator/packets.ts"
  - "src/orchestrator/packets.test.ts"
  - "src/cli/**"
  - "src/run-report/**"
  - "src/agents/**"
  - "src/guard/**"
  - "src/validate/**"
  - "src/install/**"
  - "src/schema/**"
  - "commands/**"
  - "agents/**"
  - "README.md"
  - "package.json"
  - "pnpm-lock.yaml"
  - "tsconfig.json"
  - "vitest.config.ts"
verify_commands:
  - "pnpm test"
  - "pnpm typecheck"
---
## Scope

Add a two-layer sequence-integrity invariant to the per-epic decisions ledger, all inside
`src/orchestrator/decisions-ledger.ts` (+ its colocated test). Today `DecisionsLedgerSchema`
(`decisions-ledger.ts:29-31`) accepts repeated and out-of-order IDs, and `appendDecision`
(`decisions-ledger.ts:91-107`) writes a new entry without checking it against the Core-computed next
ID — so a repeated or miscomputed ID is accepted silently. This closes that gap.

**Read layer (schema refinement on `DecisionsLedgerSchema`):**
- Decision IDs within one active ledger must be **unique**.
- Decision IDs must be **strictly increasing by numeric value** in ledger order (compare the integer
  after the `D-` prefix; entries already match `D-<digits>` via `LedgerEntrySchema`).
- A **gap** (e.g. `D-001`, `D-003`) is **tolerated on read** — the read layer checks structural
  sanity only, so an already-on-disk ledger stays readable.

**Append layer (in `appendDecision`):**
- The appended decision ID must **equal `nextDecisionId(existing)`** — the deterministic Core
  allocator's next value, computed from the current ledger's IDs.
- A repeated ID, a lower ID, or a higher-than-next ID is **rejected with no write**.
- Reuse the deterministic allocator: import `nextDecisionId` from `./decision-id.js` (read-only
  import; `decision-id.ts` is **not** edited). This also has the effect of verifying any caller's
  proposed ID against Core's own allocator at the write boundary.

## Out of Scope

- Any change to `src/orchestrator/decision-id.ts` or `decision-id.test.ts` — `nextDecisionId` stays
  exactly as-is and is only imported. Its deliberate tolerance of gaps/repeats in its *input list*
  (`decision-id.test.ts:20-22, 46-48`) is correct allocator robustness and must not change.
- Any change to `forge dispatch pm` decision-ID assignment flow — making Core assign the ID internally
  is a later, separate concern, not this ticket.
- Any change to `src/cli/**`, `src/run-report/**`, `src/agents/**`, `src/guard/**`, `src/validate/**`,
  `src/install/**`, `src/schema/**`, `commands/**`, `agents/**`, or `README.md`.
- `run_id` or `attempt_id`; status write-back; ticket/manifest/governance edits; journal automation;
  hooks; `forge doctor`; `forge init-target`; installer or plugin packaging; auto commit / push / PR /
  merge; multi-ticket behavior.

## AI Instructions

- TDD per the house style: write the RED tests first in
  `src/orchestrator/decisions-ledger.test.ts` before any implementation code.
- **Read-layer refinement:** add a `.superRefine` to `DecisionsLedgerSchema` (`decisions-ledger.ts`)
  that fails when two entries share a decision ID, or when an entry's numeric ID is not strictly
  greater than the previous entry's. Surface it through the existing `readDecisionsLedger` path as the
  existing typed `LEDGER_INVALID` failure (the same code already used for malformed / wrong-shape
  ledgers). Keep the object `.strict()`.
- **Append-layer check:** in `appendDecision`, after the existing entry-shape check
  (`LedgerEntrySchema`) and the existing-ledger read, compute
  `expected = nextDecisionId(current.ledger.decisions.map((d) => d.decision_id))` and reject when the
  new entry's `decision_id` is not exactly `expected`. Return a typed failure with **no write**.
- **Append failure code:** prefer a dedicated code **`LEDGER_SEQUENCE_INVALID`** on the
  `AppendLedgerResult` union, because the append rule covers repeated, lower, and higher-than-next
  cases — it is a sequence-integrity failure, not only ordering. If that name is awkward in the
  existing result union, use `LEDGER_NON_MONOTONIC` instead and add a code comment documenting that it
  also covers the repeated-ID and gap-on-append cases. Keep the existing `LEDGER_INVALID` (file-level)
  and `LEDGER_ENTRY_INVALID` (entry-shape) codes and their current behavior intact.
- **Per-attempt `D-001` reuse:** the invariant is scoped to a single active ledger file only. A fresh
  active ledger (empty / absent) must still accept `D-001` (`nextDecisionId([]) === "D-001"`) even when
  an archived sibling ledger under a path like `.forge/escalate-attempt<N>/decisions-ledger.json` also
  holds `D-001`. Do not introduce any cross-file constraint.
- Keep the existing tests green: the `readDecisionsLedger` valid-file cases, the `appendDecision`
  empty→`D-001` and `[D-001]`→`D-002` cases, and the integration replay
  (`decisions-ledger.test.ts:157-178`, dense `D-001`→`D-002`) all stay passing — they are already
  unique, in order, and exactly the next ID.
- Word any new prose and messages around "reject duplicate IDs / reject out-of-order IDs / sequence
  integrity"; keep it precise and low-drama.

## Acceptance Criteria

- [ ] Reading a ledger whose decisions contain a duplicate `decision_id` fails with a typed
      invalid-ledger result (`LEDGER_INVALID`); a new RED→GREEN test asserts it.
- [ ] Reading a ledger whose `decision_id` values decrease in order (e.g. `D-002` then `D-001`) fails
      with a typed invalid-ledger result (`LEDGER_INVALID`); a test asserts it.
- [ ] `appendDecision` rejects a duplicate `decision_id` with a typed failure and **no write**
      (observed via the IO seam writes array); a test asserts it.
- [ ] `appendDecision` rejects a lower-than-next `decision_id` with a typed failure and no write; a
      test asserts it.
- [ ] `appendDecision` rejects a higher-than-next `decision_id` (gap) with a typed failure and no
      write; a test asserts it.
- [ ] `appendDecision` accepts an entry whose `decision_id` equals `nextDecisionId(existing)`, writes
      once, and preserves prior entries in order; a test asserts it.
- [ ] A fresh active ledger (empty/absent) accepts `D-001` even when an archived sibling ledger also
      contains `D-001` — per-attempt reuse is preserved; a test asserts it (distinct file paths through
      the IO seam, no cross-file constraint).
- [ ] The existing dense `D-001` → `D-002` read→`nextDecisionId`→append replay behavior
      (`decisions-ledger.test.ts:157-178`) stays green; existing valid-file and empty/`[D-001]` append
      tests stay green.
- [ ] `src/orchestrator/decision-id.ts`, `decision-id.test.ts`, `dispatch.ts`, `dispatch.test.ts`,
      `packets.ts`, `packets.test.ts`, and every path under `src/cli/`, `src/run-report/`,
      `src/agents/`, `src/guard/`, `src/validate/`, `src/install/`, `src/schema/`, `commands/`,
      `agents/`, plus `README.md`, are unchanged (git diff empty for each).
- [ ] `pnpm test` and `pnpm typecheck` pass.
