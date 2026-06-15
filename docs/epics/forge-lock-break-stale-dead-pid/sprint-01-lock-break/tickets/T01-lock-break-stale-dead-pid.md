---
schema_version: 1
id: T01
title: Human-gated lock break for same-host stale dead-PID holder
kind: green
risk: high
change_class: feature
blast_radius: cross_module
status: pending
depends_on: []
blocks: []
allowed_paths:
  - src/orchestrator/lock.ts
  - src/orchestrator/lock.test.ts
  - src/orchestrator/lock-cli.ts
  - src/orchestrator/lock-cli.test.ts
  - docs/epics/forge-lock-break-stale-dead-pid/**
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - workflows/forge-run-ticket.workflow.js
  - scripts/**
  - src/workflows/**
  - src/agents/**
  - src/cli/**
  - src/cli.ts
  - src/index.ts
  - src/repo/**
  - src/guard/**
  - src/run-report/**
  - src/schema/**
  - src/validate/**
  - src/importer/**
  - src/install/**
  - src/fs/**
  - src/orchestrator/decision-id.ts
  - src/orchestrator/decisions-ledger.ts
  - src/orchestrator/ledger-cli.ts
  - src/orchestrator/packets.ts
  - src/orchestrator/dispatch.ts
  - agents/**
  - commands/**
  - .claude/**
  - vitest.config.ts
  - tsconfig.json
  - package.json
  - pnpm-lock.yaml
  - README.md
  - docs/governance/**
  - "**/.forge/**"
  - sandbox-epic/**
  - pilot-local/**
  - templates/**
  - .github/**
---

# T01 — Human-gated lock break for same-host stale dead-PID holder

## Scope

Add a **human-gated** `forge lock break` command that clears an orphaned epic lock **only** when the holder is
provably dead on the same host. Detection reuses the existing `staleVerdict`; this ticket adds a new pure
`breakStaleLock` to `src/orchestrator/lock.ts` and a `break` subcommand to `src/orchestrator/lock-cli.ts`, plus
tests. v1 is **same-host provable-death only** — TTL-only break, cross-host break, and a heartbeat updater are all
out of scope. `acquire` / `release` / `status` semantics are unchanged.

## Core invariant (the reason this ticket exists)

> Forge may break a stale lock **only** when the current lock holder is **provably dead on the same host**, the
> operator **explicitly echoes the holder `run_id`**, and the lock is **re-read immediately before clearing** to
> ensure the holder has not changed. Operator convenience never outranks live-lock safety.

## Out of scope (halt-and-report if any becomes necessary)

- TTL-only / heartbeat-only break (no `--allow-ttl-only`) — deferred. An aged heartbeat does **not** prove death
  (no heartbeat updater exists).
- Cross-host break — deferred (cross-host PID liveness is unverifiable).
- A heartbeat updater — separate future work.
- Any change to `acquire` / `release` / `status` semantics.
- Workflow crash-path code, launcher cleanup code, F1 role-output persistence, safe-mode detection, status
  write-back, permission carve-outs, worktree/shared-state architecture.
- `src/cli/run.ts` — the `lock` route already delegates to `runLock`; adding a `break` subcommand needs no router
  change. If a router change appears necessary, **stop and report** (it is a re-scope).

## Discovery findings (inspected, not assumed; line numbers at the contract baseline)

1. **Detection already exists.** `staleVerdict` (`src/orchestrator/lock.ts:240-272`) reports `dead_pid` (same-host
   only — cross-host PID liveness is not consulted), `expired_heartbeat`, `exceeded_acquire_ttl`, and a `crossHost`
   flag. It **never clears**.
2. **`heartbeat_ts` is not live.** `acquire` sets `heartbeat_ts = acquired_ts` (`lock-cli.ts:137,150-151`) and
   nothing updates it during a run. So `expired_heartbeat` / `exceeded_acquire_ttl` can fire on a **healthy** long
   run → they cannot authorize a break. Same-host `dead_pid` is the only provable-death signal.
3. **The clear mechanism exists.** `LockIo.removeFile` (`lock.ts:69-70`; real binding `fs.rmSync({force:true})`,
   `lock-cli.ts:81-83`) is today reachable only via owner-checked `releaseLock`.
4. **`release` is owner-checked, not death-aware.** `releaseLock(file, runId, io)` (`lock.ts:213-222`) clears when
   `runId === holder.run_id` regardless of whether that run is alive — so it must **not** be the recovery path for a
   foreign orphan.
5. **`status` is report-only** (`lock-cli.ts:195-234`), exits 0 even when stale; the `lock-cli.ts` header already
   names stale-recovery a deferred slice.
6. **Routing:** `src/cli/run.ts:85-86` delegates `lock` → `runLock`; the new subcommand lives entirely inside
   `runLock` (no `run.ts` change).

## Required command shape

```
forge lock break <epic> --confirm-run-id <holder-run-id> --yes
```

Preview mode (no flags beyond the epic; **must not mutate state**):

```
forge lock break <epic>
```

- **Preview** computes and prints what *would* be broken and why (holder + stale reasons), and **clears nothing**.
- The break proceeds only with **both** `--confirm-run-id <holder-run-id>` (echoing the on-disk holder) **and**
  `--yes`.
- `--heartbeat-ttl-ms` / `--acquire-ttl-ms` may tune the **preview/status** verdict only; they do **not** authorize
  a break (only same-host `dead_pid` does).

## Required safety behavior

The contract requires each of the following (all unit-testable; see Required tests):

- **Fresh lock refuses** (`stale: false` → typed refusal, file intact).
- **Live same-host PID refuses** (no `dead_pid` reason → typed refusal, intact).
- **Dead same-host PID may break** — only with `--confirm-run-id` + `--yes`.
- **Foreign `--confirm-run-id` (mismatch with the on-disk holder) refuses** (intact).
- **Holder changed between preview and break refuses** (re-read/CAS abort; intact).
- **Malformed lock refuses** (never clobbered).
- **Cross-host lock refuses** (no provable death; intact).
- **TTL-only stale refuses** (no `dead_pid` → not authorized; intact).
- **Heartbeat-only stale refuses** (no `dead_pid` → not authorized; intact).
- **`break` is never called automatically** by workflow execution, the command orchestrator, or any crash handler —
  human CLI only.
- **`release --run-id` owner-checked behavior remains unchanged.**
- **`lock status` remains report-only.**

## Required CAS / re-read rule

Before clearing `lock.json`, `breakStaleLock` must **re-read the lock file** and verify the `run_id` (and the
holder facts the operator confirmed) still match the operator-confirmed record. If anything changed — a new run
acquired in the window, or the file is now absent/malformed — **abort** with a typed result and clear nothing. The
clear via `LockIo.removeFile` happens only after this re-read confirms an unchanged, provably-dead holder.

## Required audit

**Minimum printed audit fields** (emitted on a successful break):

- epic path
- holder `run_id`
- holder `pid`
- holder `host`
- stale reason(s)
- operator action: `break`
- timestamp
- result

**Preferred bounded persisted audit:** `<epic>/.forge/lock-break-audit/<timestamp-or-run-id>.json` — include only if
it does not widen the scope materially; otherwise printed-only is acceptable (see Open implementation decisions).

## AI Instructions

- TDD: RED first in `src/orchestrator/lock.test.ts` (the pure `breakStaleLock` against in-memory `LockIo` + injected
  `LockClock`) and `src/orchestrator/lock-cli.test.ts` (the `break` CLI surface, incl. preview/no-mutation and the
  flag gates), then the minimal implementation. The **headline test is the negative one** — a fresh/live lock
  refuses to break.
- Keep the change additive and surgical; `acquire` / `release` / `status` and their tests stay green unmodified.
- Reuse `staleVerdict` for detection and `LockIo.removeFile` for the clear — do not add a new IO seam unless the
  audit persistence requires one (and if so, keep it injected and tested).
- Do not touch any forbidden path; `run.ts` routing is unchanged.
- `pnpm test` and `pnpm typecheck` green; scope guard clean.

## Acceptance Criteria

1. `lock status` reports stale but **does not clear** (unchanged).
2. `lock break <epic>` **preview does not mutate** state.
3. `break` **without `--yes` refuses** (preview/no-mutation).
4. `break` **without `--confirm-run-id` refuses**.
5. `break` with a **wrong `--confirm-run-id` refuses** (intact).
6. `break` on a **fresh lock refuses** (intact).
7. `break` on a **live same-host PID refuses** (intact).
8. `break` on a **dead same-host PID succeeds** (with `--confirm-run-id` + `--yes`) and clears the lock.
9. `break` on a **cross-host lock refuses** (intact).
10. `break` on a **TTL-only / heartbeat-only stale lock refuses** (no `dead_pid` → not authorized; intact).
11. `break` on a **malformed lock refuses** (never clobbered).
12. `break` **aborts if the holder changed** between preview/verdict and the clear (re-read/CAS; intact).
13. `release --run-id` owner-checked behavior is **unchanged**; `status` remains report-only.
14. A successful break emits the **minimum printed audit fields**.
15. Tests are **non-tautological** and exercise real behavior (pure `breakStaleLock` executed against in-memory
    `LockIo`/`LockClock`; CLI gates exercised), and are **genuinely RED before** the implementation.
16. `pnpm test` and `pnpm typecheck` pass; scope guard clean (only `allowed_paths` change).

## Verification

- RED→GREEN evidence; full `pnpm test` / `pnpm typecheck`.
- Governed two-pass verifiers review the diff for the invariant (dead-PID-decisive, never breaks a live/fresh lock,
  CAS re-read, human confirmation) and additivity; PM judges.
- **No live workflow proof is required for contract landing.** For implementation, a disposable-filesystem proof or
  test fixture must prove: (a) a fresh/live lock is **not** broken; (b) a same-host dead-PID lock can be broken
  **only** with explicit confirmation; (c) the holder-change race aborts.
- **No install refresh** post-merge: none of `commands/**`, `agents/**`, or `README.md` is touched.

## Ratified decisions (PM — Dan, 2026-06-15)

1. **v1 basis → same-host provable `dead_pid` only (RATIFIED).** Proceed dead-PID-decisive now.
2. **Heartbeat updater → deferred (RATIFIED).** Separate future work.
3. **Verb → `lock break` (RATIFIED).** It should sound serious; not `clear`/`recover`.
4. **Audit → printed required; persisted gitignored artifact preferred if bounded (RATIFIED).**
5. **Thresholds → preview/status only, never break authorization (RATIFIED).**
6. **TTL-only / cross-host override → deferred (RATIFIED).** No TTL-only or cross-host break in v1.

## Open implementation decisions (for the PM)

1. **Persisted audit.** Include `<epic>/.forge/lock-break-audit/<id>.json` (preferred, needs a small injected
   writer) **or** ship printed-only this ticket if persistence would widen scope? Recommendation: **printed-only +
   the persisted file only if it stays a one-line write through the existing `LockIo` (no new seam)**; otherwise
   defer persistence.
2. **`risk`.** Authored **`risk: high`** (it clears a lock file — the live-lock-safety surface). Confirm, or prefer
   `medium` (consistent with F2). It does **not** change the effective gate (escalation is `change_class`/keyword
   driven, not risk-driven), so gate stays `pr`.
3. **Typed refusal codes.** Suggested set: `LOCK_NOT_STALE`, `LOCK_LIVENESS_UNPROVEN` (stale but no `dead_pid`),
   `LOCK_CROSS_HOST` (or fold into `LOCK_LIVENESS_UNPROVEN`), `LOCK_CONFIRM_MISMATCH`, `LOCK_CHANGED`,
   `LOCK_ABSENT`, `LOCK_MALFORMED`. Confirm the names/granularity at implementation.
