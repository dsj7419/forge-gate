# Epic — Lock wiring: Core CLI surface for the epic lock

## Why

T01 of `forge-cross-run-concurrency` (merged PR #34, `831e412`) shipped the Core epic-lock primitive
(`src/orchestrator/lock.ts`) and the atomic/CAS decisions-ledger append. The primitive is pure and seam-injected:
it has **no real filesystem binding and no CLI surface yet**, so no orchestrator can actually take the lock.

The cross-run concurrency story has a load-bearing nuance that must be carried forward explicitly: the **epic lock
is the primary cross-run serialization guarantee**, and the **CAS ledger append is defense-in-depth**. The CAS narrows
but does not hermetically close the append race without an OS-level lock (a residual re-check-to-rename window
remains); that window is acceptable **only when the lock serializes appends**. So the lock has to become real and
callable before it can do its job.

This epic adds the smallest real step: a **Core CLI surface** — `forge lock acquire | release | status` — with the
real `defaultLockIo` filesystem binding (exclusive-create acquire, owner-checked release, report-only stale verdict),
fail-closed on contention. It does **not** wire any orchestrator yet: the Markdown orchestrator and the
workflow-backed runner keep their current behavior; teaching them to call `forge lock` is the next slice.

## Goal

Expose the shipped lock primitive as a deterministic, fail-closed `forge lock` CLI surface backed by a real
filesystem `LockIo`, so a later slice can wire it into the orchestrator entrypoint as the primary cross-run
serialization. Acquire is the exclusive-create mutual exclusion; release is owner-checked; status reports a stale
verdict without ever clearing or stealing a lock.

## Sprints

- `sprint-01-lock-cli-surface` — one ticket: the `forge lock` CLI surface + real `defaultLockIo` binding.

## Out of scope (this epic)

- Orchestrator-command wiring (`commands/forge-run-ticket.md` calling `forge lock`) — the next slice.
- Workflow-backed runner wiring (`workflows/**`).
- Stale-recovery UX (any assisted or forced clearing of a stale or foreign lock) — report-only here.
- Evidence-write ownership / `run_id` artifact enforcement across run-report / active-ticket / orchestrator-facts.
- Any change to the shipped lock primitive (`src/orchestrator/lock.ts`) or the ledger modules.

## Carried-forward decisions (ratified)

1. The **epic lock is the primary cross-run serialization guarantee**.
2. The **CAS ledger append remains defense-in-depth**.
3. The residual CAS re-check-to-rename window is acceptable **only when lock wiring serializes appends**.
4. No stale-recovery UX yet (status reports staleness; clearing a stale/foreign lock is a later slice).
5. No workflow wiring unless explicitly scoped.
6. No evidence ownership / `run_id` artifact enforcement yet.
