# Epic — Make forge lock acquire idempotent for the same owner

## Why

A clean-epic workflow run can self-collide on lock acquisition. The workflow issues **one** `forge lock acquire`,
but the `forge-core-runner` subagent non-deterministically executed the handed-off command more than once in a
single dispatch. The first execution created the lock (`run_id=X`); the second repeated the same acquire with the
same `run_id` and Core returned `LOCK_HELD` against the caller's **own** lock — a spurious `PREFLIGHT_LOCK_HELD`
escalate. This makes a clean-epic PASS path **non-deterministic** and currently blocks the conclusive
scratch-isolation proof (observed in the OS-temp launch proof, full run `wf_4863fb66-3c1`).

The wrong answer is in Core, not in workflow handling: `acquireLock` (`src/orchestrator/lock.ts`) returns
`LOCK_HELD` on **any** collision without checking whether the existing holder's `run_id` matches the requested
one. **Acquire is not idempotent for the same owner**, asymmetric with `releaseLock`, which *is* owner-checked by
`run_id`.

## What

Make `acquireLock` idempotent for the same `run_id`: on a collision, if the existing on-disk holder's `run_id`
equals the requested `run_id`, return success `{ ok: true, record: existingRecord }` (the run already owns the
lock) and leave the existing record intact. A *different* `run_id` still returns `LOCK_HELD` (mutual exclusion
preserved). Core-owned; no workflow-specific handling.

## Scope discipline

A small, deterministic, Core-owned correctness fix to a load-bearing primitive used by both orchestrators. It does
NOT touch scratch/capture behavior, the workflow, the CLI envelope (by default), or any other Core module.

## Tickets

- **T01** — Make `forge lock acquire` idempotent for the same owner.

## Claude Code Substrate Review

- **Forge Core** owns lock correctness. This fix makes the primitive robust to a duplicate acquire by the same
  owner rather than depending on the core-runner subagent executing the command exactly once (a non-determinism
  artifact the charter cannot fully prevent — the same lesson as the scratch capture).
- **Workflows / orchestrators** are unchanged: both consume the corrected primitive.
- **Tests** drive the real `acquireLock` with an in-memory `LockIo` (deterministic, no Workflow tool / subagent).
