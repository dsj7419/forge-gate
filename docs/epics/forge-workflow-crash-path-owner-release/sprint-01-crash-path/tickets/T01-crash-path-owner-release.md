---
schema_version: 1
id: T01
title: Crash-path owner-checked release on unhandled workflow failure
kind: green
risk: medium
change_class: feature
blast_radius: cross_module
status: pending
depends_on: []
blocks: []
allowed_paths:
  - workflows/forge-run-ticket.workflow.js
  - src/workflows/**
  - docs/epics/forge-workflow-crash-path-owner-release/**
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - .claude/**
  - agents/**
  - commands/**
  - scripts/**
  - src/agents/**
  - src/orchestrator/**
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

# T01 — Crash-path owner-checked release on unhandled workflow failure

## Scope

Make the workflow-backed runner survive an unhandled post-acquire failure cleanly. Wrap the workflow lifecycle so
that **any** unhandled error performs an owner-checked release (a no-op when nothing was acquired) and emits a
typed terminal outcome (`UNHANDLED_WORKFLOW_FAILURE`), instead of letting the throw escape and orphan `lock.json`.

This is a bounded control-flow change to `workflows/forge-run-ticket.workflow.js` plus its tests. It does NOT
change Core, the lock primitive, the release API, role-output persistence (F1, deferred), the launcher (F3,
separate), the charters, or the hook.

## Out of scope (halt-and-report if any becomes necessary)

- Any Core change — `src/orchestrator/lock.ts` and all Core surfaces are forbidden. The release API
  (`forge lock release --run-id`, owner-checked + idempotent per #53) and the workflow's `releaseLockIfOwned()`
  are sufficient; if implementation appears to need a Core change, **stop and report** (it is a re-scope).
- F1 role-output persistence re-architecture (deferred/open; answerable only by an in-context workflow proof).
- F3 launcher cleanup EPERM typed UX (separate small follow-up; `scripts/launch-workflow.mjs` is forbidden).
- Stale-lock recovery UX (force/clear of an already-orphaned lock from hard process death) — separate.
- Any change that makes the classifier denial impossible, or that retries a denied action ("retry until green" is
  not operability — this ticket handles the *failure*, it does not fight the substrate).

## Discovery findings (inspected, not assumed; line numbers at the contract baseline)

1. **The release machinery already exists and is correct.** `releaseLockIfOwned()`
   (`workflows/forge-run-ticket.workflow.js:866-875`) releases **iff `acquired === true`**, keyed by `runId`;
   surfaces `LOCK_FOREIGN`/`LOCK_ABSENT`/`LOCK_MALFORMED` without overriding; sets `acquired = false` afterward
   (so it cannot double-release). `escalate()` (`:885-894`) and the PASS return (`:815-832`) both call it.
2. **The gap is the absence of a lifecycle try/catch.** An unhandled throw between acquire (`:447-448`) and a
   terminal return — e.g. `writeForgeFile` throwing on a denial (`:226-228`), or any `runCore*` throwing — escapes
   the workflow and reaches none of the release paths, orphaning the lock.
3. **`acquired` is the single ownership flag** (`:102`, set true at `:448`, reset false in `releaseLockIfOwned`).
   It already makes a release a no-op pre-acquire and prevents double-release — so a single try/catch around the
   whole body is safe.
4. **The standard terminal shapes** are `escalate` → `{result:"ESCALATE", code, evidence, outward_action_taken}`
   and PASS → the handoff object. The crash terminal is a **richer** shape (run_id + error detail + release
   attempt/result) and must NOT overload `escalate()`'s semantics.

## Required behavior

- **Single try/catch around the workflow lifecycle (catch-only — RATIFIED).** Wrap the workflow body so an
  unhandled error at any point is caught. The `catch` is the **sole** load-bearing path; **do not add a `finally`
  release guard** — `releaseLockIfOwned()` is already `acquired`-gated and idempotent, so a `finally` would be a
  no-op that adds only double-release / return-shape risk.
- **Release-first crash handling.** In the catch: (1) attempt the owner-checked release via `releaseLockIfOwned()`
  inside its **own** guard, so a release-time failure is recorded — not re-thrown; (2) **only after** the release
  attempt, best-effort emit evidence (optional, guarded) — an evidence-writing failure must never block or undo
  the release; (3) return the typed terminal outcome.
- **Distinct terminal builder.** A pure helper (e.g. `buildUnhandledFailure(error, releaseResult)`) constructs the
  typed outcome. It is placed so a source-level test can **extract and execute** it (between sentinel comments,
  the established `evaluateLaunchCwd` pattern) — not overloading `escalate()`.
- **Owner-safety preserved.** A foreign/absent/malformed release result is recorded, never overridden, never
  force-cleared.
- **Pre-acquire crash safety.** An unhandled error before acquire attempts no release (nothing owned) and still
  emits the typed terminal.
- **PASS / standard-ESCALATE paths unchanged.** Their outcomes and shapes are byte-for-byte unaffected.

## Required typed outcome

The crash terminal object must include:

- `result: "ESCALATE"`
- `code: "UNHANDLED_WORKFLOW_FAILURE"`
- `outward_action_taken: false`
- `human_gate_required: true`
- `run_id`
- `lock_release_attempted` (boolean)
- `lock_release_result` (the `releaseLockIfOwned` return, or null if pre-acquire / not owned)
- `original_error_class`
- `original_error_message`

**Original error details must be sanitized/truncated** — `original_error_class` + a bounded
`original_error_message`; **no full stack trace** in the returned terminal object.

## AI Instructions

- TDD: RED the crash-path tests first in `src/workflows/**` (source-level protocol assertions that the lifecycle
  is wrapped, the catch releases-before-evidence, the typed code is emitted; plus an extract-and-execute test of
  the pure `buildUnhandledFailure` outcome shape), then the minimal workflow change.
- Keep the wrapping additive and the change surgical; the existing lock-protocol and launch-cwd protocol suites
  must stay green unmodified.
- Do not touch Core, the lock primitive, the launcher, the charters, the hook, or the command orchestrator.
- `pnpm test` and `pnpm typecheck` green; scope guard clean.

## Acceptance Criteria

1. A **post-acquire unhandled failure releases the owned lock** (owner-checked, keyed by this `run_id`).
2. A **post-acquire unhandled failure does NOT release a lock owned by another `run_id`** (foreign result
   recorded, not cleared).
3. A **failure during evidence/report writing still releases the owned lock** (an evidence-write throw does not
   block the release).
4. A **typed terminal `UNHANDLED_WORKFLOW_FAILURE` is emitted with `outward_action_taken: false`** and the
   required fields (run_id, lock_release_attempted, lock_release_result, sanitized original_error_class/message,
   human_gate_required: true).
5. **Normal PASS path behavior is unchanged** (existing lock + launch-cwd protocol suites stay green; the PASS
   handoff object is byte-for-byte unaffected).
6. A **pre-acquire failure does not attempt a release** (nothing owned → no release call) and still emits the
   typed terminal.
7. Tests are **non-tautological and exercise the lifecycle boundary** (wrapping present + ordering
   release-before-evidence + typed code + the pure builder extracted-and-executed), not just a helper asserted in
   isolation. They are **genuinely RED before** the workflow change.
8. `pnpm test` and `pnpm typecheck` pass; scope guard clean (only `allowed_paths` change).
9. No Core / lock-primitive / launcher / charter / hook / command change; the release API is consumed unchanged.

## Verification

- RED→GREEN evidence for the crash-path tests; full `pnpm test` / `pnpm typecheck`.
- Governed two-pass verifiers review the diff for additivity + the release-first invariant; PM judges.
- **No live Workflow-tool run is required** to prove F2 — the failure path is unit/protocol-testable. An optional,
  human-approved in-context confirmation (re-run the operability scenario and observe the crash now terminating
  cleanly with an owner-checked release instead of an orphaned lock) is a nice-to-have, not a gate.
- **No install refresh** post-merge: neither `workflows/**` nor `src/workflows/**` is installed by
  `install-commands` (this ticket does not touch `commands/**` or `README.md`).

## Ratified decisions (PM — Dan, 2026-06-14)

1. **`risk` / `blast_radius` → `risk: medium`, `blast_radius: cross_module` (RATIFIED).** A focused workflow
   control-flow fix, not a Core lock-primitive change; the lock primitive and the release API are unchanged.
2. **Crash-path run-report → NO / report-free (RATIFIED).** T01 emits the owner-checked release plus the typed
   `UNHANDLED_WORKFLOW_FAILURE` terminal **only** — **no extra crash-path `.forge/` writes.** The typed terminal is
   the forensic record for T01.
3. **`finally` guard → NO / catch-only (RATIFIED).** The `catch` is the sole load-bearing path; no `finally`
   release guard (`releaseLockIfOwned()` is `acquired`-gated and idempotent).

**PM rationale (verbatim):** This is a focused workflow control-flow fix, not a Core lock primitive change. Lock
release is critical. Evidence/reporting is best-effort. The typed `UNHANDLED_WORKFLOW_FAILURE` terminal is the
forensic record for T01. Do not add extra crash-path `.forge` writes unless a later ticket specifically justifies
them.

## Implementation sequencing recommendation

One governed `/forge-run-ticket` self-run after this contract lands: RED crash-path protocol + builder tests →
single try/catch wrap with release-first catch + `buildUnhandledFailure` → GREEN → engineer → verifiers → PM →
stop at the commit gate. No install refresh; no live run required. F3 (launcher EPERM UX) follows as its own small
epic; F1 remains deferred/open pending an in-context persistence proof.
