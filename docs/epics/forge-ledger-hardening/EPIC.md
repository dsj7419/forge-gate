# ForgeGate — decisions-ledger sequence-integrity hardening

Close a real, current Core gap: the per-epic decisions ledger does not enforce that decision IDs are
unique and in order. `nextDecisionId` is deterministic, but `DecisionsLedgerSchema` accepts a ledger
with repeated or out-of-order IDs, and `appendDecision` writes a new entry without checking it against
the Core-computed next ID. A miscomputed or repeated ID would be accepted silently — under the current
Markdown orchestrator today, and under any future execution substrate.

- **Goal:** make the decisions ledger enforce sequence integrity at two layers, without expanding
  ForgeGate's autonomy or changing any other surface. This is the C4 hardening item carried by
  `docs/workflow-era-architecture-audit.md` and `docs/workflow-backed-runner-design.md`, split out as
  an immediate standalone ticket because the gap exists now, not only in the future runner.
- **Two-layer invariant:**
  - **Read layer** — a single active `decisions-ledger.json` must have unique decision IDs, strictly
    increasing by numeric value in ledger order. Gaps are tolerated when *reading* an existing ledger
    (structural sanity only).
  - **Append layer** — an appended decision ID must equal `nextDecisionId(existing)`. Repeated, lower,
    or higher-than-next IDs are rejected with no write.
- **Non-goals (this epic):** any change to `forge dispatch pm` decision-ID assignment flow (that is
  Phase B, folded with gate provenance); any change to `nextDecisionId` itself; any change to the
  agent parsers, run-report schema, packets, dispatch, the CLI router, the orchestrator command, or
  the README; hooks; `forge doctor`; `forge init-target`; installer or plugin packaging; status
  write-back; journal automation; `run_id`; `attempt_id`; auto commit / push / PR / merge;
  multi-ticket behavior.
- **Constraints:** human-gated; one ticket at a time; the run stops at the commit gate; the engineer
  edits only the ticket's `allowed_paths`. The deterministic allocator and the ledger's IO seam stay
  as they are — only the validation invariant is added.

## Sprints

- `sprint-01-ledger-integrity` — add the two-layer invariant to `src/orchestrator/decisions-ledger.ts`
  (read-layer schema refinement + append-layer next-ID check) with colocated tests; preserve
  per-attempt `D-001` reuse across archived ledgers (T01).

> Self-run note: this epic edits ForgeGate's own Core ledger module, so its ticket is driven with a
> **frozen build** (`pnpm build` then `FORGE_BIN="node <repo>/dist/cli.js"`) so a run cannot mutate the
> tool executing it. The shipping run's own ledger append uses the frozen pre-change behavior; the new
> invariant takes effect for runs after merge and rebuild.
