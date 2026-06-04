# Sprint 01 — Concurrency foundation

One ticket: add a Core epic-level lock primitive (atomic exclusive create, fail-closed contention, owner-checked
release, reportable stale detection) and make the decisions-ledger append atomic so a PM `decision_id` can never
duplicate or clobber another under concurrent runs.

- **T01** — Add Core epic-lock primitive and atomic decisions-ledger append.

Acceptance evidence is deterministic unit tests behind injected IO seams plus a ledger-append interleaving harness
that proves no duplicate and no lost update — never real sleeps or timers, never a real destructive operation. No
orchestrator or workflow wiring; no evidence-write ownership; no stale-recovery UX beyond safe detection and
reporting.

## Anchoring (T01 implementation note)

The lock primitive (`src/orchestrator/lock.ts`) takes its **lock-file path from the caller**; it invents no
worktree-aware path logic. Canonically that path is the repo-root / canonical-epic `$EPIC/.forge/lock.json`, and the
decisions ledger lives alongside it at `$EPIC/.forge/decisions-ledger.json`. Both are anchored to the canonical
`.forge` for this slice.

**Worktree isolation remains unsafe for shared decision provenance.** A separate `git worktree` carries its own
`docs/epics/<epic>/.forge/decisions-ledger.json`, so two worktree-isolated runs would each start from an
independent (empty) ledger and both mint `D-001` — the cross-run decision-id guarantee would break *worse*, not
better. Until ForgeGate has a stable, non-worktree-fragmented shared-state location (keyed to the canonical
repo/epic identity), runs that share decision provenance must share one canonical `.forge`. Solving that location is
explicitly deferred to a later slice (see `docs/cross-run-concurrency-discovery.md` §9 and the epic's deferred
design note).
