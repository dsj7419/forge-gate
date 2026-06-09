---
schema_version: 1
id: T01
title: Make forge lock acquire idempotent for the same owner
kind: green
risk: medium
change_class: feature
blast_radius: cross_module
status: pending
depends_on: []
blocks: []
allowed_paths:
  - src/orchestrator/lock.ts
  - src/orchestrator/lock.test.ts
  - docs/epics/forge-lock-idempotent-acquire/**
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - .claude/**
  - commands/**
  - agents/**
  - workflows/**
  - src/orchestrator/lock-cli.ts
  - src/orchestrator/lock-cli.test.ts
  - "src/orchestrator/decisions-ledger*"
  - "src/orchestrator/decision-id*"
  - "src/orchestrator/packets*"
  - "src/orchestrator/dispatch*"
  - "src/orchestrator/pm-dispatch*"
  - "src/orchestrator/index*"
  - src/cli/**
  - src/cli.ts
  - src/repo/**
  - src/guard/**
  - src/run-report/**
  - src/schema/**
  - package.json
  - pnpm-lock.yaml
  - README.md
  - docs/governance/**
  - "**/.forge/**"
  - sandbox-epic/**
  - pilot-local/**
---

# T01 — Make forge lock acquire idempotent for the same owner

## Scope

Close a Core lock-semantics gap: `acquireLock` (`src/orchestrator/lock.ts`) must be **idempotent for the same
owner**. On a collision, if the existing on-disk holder's `run_id` equals the requested `run_id`, return
`{ ok: true, record: existingRecord }` (the run already owns the lock) and leave the existing record intact. A
*different* `run_id` collision must still return `LOCK_HELD` with the holder (mutual exclusion preserved).

This is a small, deterministic, Core-owned fix. It does NOT touch the workflow, scratch/capture behavior, the CLI,
or any other module.

## Out of scope (halt-and-report if any becomes necessary)

- Any workflow change (`workflows/**`) — the workflow consumes the corrected primitive; do not add workflow-side
  "if holder is me, pretend OK" handling (rejected — it leaves the Core primitive semantically wrong).
- Any CLI envelope change (`lock-cli.ts`/`run.ts`) — the idempotent `{ ok: true, record }` flows through the
  existing acquire result emission unchanged. If a CLI change appears necessary, **stop and report** in
  `deviations` (it is a re-scope).
- Scratch/capture behavior; stale-recovery UX; the scratch-launch-cwd work; the Core execute-capture redesign;
  ledger/decision-id/packets/dispatch/schema/run-report/guard/repo modules; status write-back; journal write.

## Discovery findings (inspected, not assumed)

1. **Observed:** clean-epic workflow run `wf_4863fb66-3c1` (`.forge` empty before launch) escalated
   `PREFLIGHT_LOCK_HELD` with **holder.run_id = the run's own id** (`proof-launch-full-run`). The prior run
   `wf_a5da3336-3fc` reached PASS — so this is non-deterministic.
2. **Trigger:** the workflow issues `forge lock acquire` exactly once (`workflows/forge-run-ticket.workflow.js:310`),
   but the `forge-core-runner` subagent non-deterministically executed the handed-off command more than once in
   one dispatch (a subagent artifact the charter cannot fully prevent). The first execution created the lock; the
   second repeated the identical acquire with the same `run_id`.
3. **The bug:** `acquireLock` (`src/orchestrator/lock.ts:171-196`) returns `LOCK_HELD` on **any** collision after
   reading the existing holder, **without comparing the holder's `run_id` to the requested `run_id`.** So a run
   re-acquiring its own lock is told `LOCK_HELD` (holder = itself). `releaseLock` (`:204-213`) is already
   owner-checked by `run_id`; acquire is the asymmetric gap.
4. **Other bridge commands are already double-run-safe** (ledger append → sequence/CAS rejects a duplicate;
   run-report / active-ticket `--out` → byte-identical; reads → harmless). `lock acquire` was the one command
   whose double-run produced a wrong outcome — so this is the only fix needed.
5. **Run identity is a UUID** (per the launcher), so a same-`run_id` lock on disk is provably the *same* run; a
   different `run_id` is a genuine foreign holder. The idempotency is therefore safe and preserves mutual
   exclusion.

## Required behavior

In `acquireLock`, on a collision (after the existing holder is read back and parsed):
- **If `existingRecord.run_id === proposed.run_id`** → return `{ ok: true, record: existingRecord }`. The existing
  record is returned **as-is** and **not overwritten** (no second write; the on-disk content is unchanged).
- **Else** → return `{ ok: false, code: "LOCK_HELD", holder: existingRecord }` (unchanged).
- `LOCK_MALFORMED` (unparseable existing lock) and absent-after-collision (`createExclusive` reported a collision
  but no file is present) behavior remain **unchanged**.
- `releaseLock` semantics remain **unchanged** and owner-checked.

## AI Instructions

- TDD: write the failing unit test(s) first (same-owner re-acquire → ok), then the minimal change in
  `acquireLock`.
- Keep the change surgical: only the collision branch of `acquireLock` gains the owner-match fast path. Do not
  alter the success path, the up-front validation, `releaseLock`, `readLock`, `staleVerdict`, the schema, or the
  IO seam.
- No workflow change; no CLI change; no other Core module change. A needed change elsewhere is a halt-trigger
  reported in `deviations`.
- Run `pnpm test` and `pnpm typecheck`; both must stay green.

## Acceptance Criteria

1. `acquireLock` returns `{ ok: true, record }` when the existing on-disk lock has the **same** `run_id` as the
   requested acquire.
2. On same-owner re-acquire, the returned record is the **existing** record and the on-disk lock content is **not
   overwritten** (no second write).
3. A **different** `run_id` collision still returns `{ ok: false, code: "LOCK_HELD", holder }`.
4. `LOCK_MALFORMED` behavior is unchanged.
5. Absent-after-collision behavior is unchanged.
6. `releaseLock` semantics are unchanged and owner-checked.
7. Unit tests drive the **real** `acquireLock` primitive with an in-memory `LockIo` (no Workflow tool / subagent).
8. Unit tests prove: (a) first acquire by `run_id X` succeeds; (b) second acquire by the same `run_id X`
   succeeds; (c) the second acquire returns the existing record; (d) the lock content is not overwritten by the
   idempotent acquire; (e) acquire by `run_id Y` still returns `LOCK_HELD`; (f) malformed-lock behavior is
   unchanged (extend only if easy without broadening scope).
9. No workflow changes; no scratch/capture changes; no CLI changes (unless strictly justified and reported).
10. `pnpm test` and `pnpm typecheck` pass; scope guard clean (only `allowed_paths` change).

## Verification

- New non-tautological `lock.test.ts` cases driving the real `acquireLock` with in-memory `LockIo`
  (same-owner→ok + record + no-overwrite; foreign→LOCK_HELD; malformed unchanged).
- Focused: `pnpm test -- lock` (or the nearest equivalent for `src/orchestrator/lock.test.ts`).
- Governed two-pass verifiers review diff + proof; PM judges. **No live workflow execution in this ticket.**
- **Post-merge live confirmation (separate governed step):** re-run the OS-temp-launched **full** workflow proof
  → it should now reach the PASS-path stages (no self-collision on its own lock), exercising the guard +
  agent-schema bridge calls. Then scan session repo / scratch launch cwd / clone for `TEMP*`. This run is also the
  decisive scratch-launch-cwd proof.

## Open decisions (for the PM)

1. **`risk`/`blast_radius` mapping.** You specified "moderate"/"core"; the schema risk enum is
   `low|medium|high|critical` (no "moderate") and the blast_radius enum tops out at `app` (no "core" value).
   Authored as **risk: medium**, **blast_radius: cross_module** (a load-bearing primitive shared by both
   orchestrators). Confirm, or prefer `blast_radius: app`.
2. **CLI envelope.** Default: no `lock-cli.ts` change (the idempotent `{ ok: true, record }` flows through). The
   CLI is in `forbidden_paths`; if the engineer finds a CLI change is strictly required, that is a halt-and-report
   re-scope.
3. **Optional `already_owned` signal.** Whether to expose an explicit `already_owned: true` flag on the idempotent
   acquire result is deferred (not required; the `{ ok: true }` is sufficient for both orchestrators).

## Implementation sequencing recommendation

One governed `/forge-run-ticket` self-run — RED the same-owner idempotent-acquire test → minimal `acquireLock`
owner-match branch → GREEN → engineer → verifiers → PM → stop at the commit gate. After merge (no install refresh
— Core source is not installed), **re-run the OS-temp-launched full workflow proof** to confirm the self-collision
is gone AND to settle the scratch-launch-cwd question conclusively.
