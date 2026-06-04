# Sprint 01 — Concurrency foundation

One ticket: add a Core epic-level lock primitive (atomic exclusive create, fail-closed contention, owner-checked
release, reportable stale detection) and make the decisions-ledger append atomic so a PM `decision_id` can never
duplicate or clobber another under concurrent runs.

- **T01** — Add Core epic-lock primitive and atomic decisions-ledger append.

Acceptance evidence is deterministic unit tests behind injected IO seams plus a ledger-append interleaving harness
that proves no duplicate and no lost update — never real sleeps or timers, never a real destructive operation. No
orchestrator or workflow wiring; no evidence-write ownership; no stale-recovery UX beyond safe detection and
reporting.
