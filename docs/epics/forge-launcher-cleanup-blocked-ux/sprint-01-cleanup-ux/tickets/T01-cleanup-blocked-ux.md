---
schema_version: 1
id: T01
title: Typed CLEANUP_BLOCKED for launcher cleanup when the scratch cwd is still held
kind: green
risk: medium
change_class: feature
blast_radius: module
status: pending
depends_on: []
blocks: []
allowed_paths:
  - scripts/launch-workflow.mjs
  - src/workflows/launch-workflow.test.ts
  - docs/epics/forge-launcher-cleanup-blocked-ux/**
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - workflows/forge-run-ticket.workflow.js
  - scripts/install-commands.mjs
  - scripts/run-forge-cli.mjs
  - .claude/**
  - agents/**
  - commands/**
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

# T01 — Typed CLEANUP_BLOCKED for launcher cleanup when the scratch cwd is still held

## Scope

Make the launcher's `cleanup` phase surface a **typed, actionable `CLEANUP_BLOCKED`** result when the Forge-owned
scratch launch directory cannot be torn down because it is still busy/locked (held open as a live
scratch-launched Claude session's cwd → Windows `EPERM`/`EBUSY`), instead of letting the raw OS error escape as an
untyped stack with a non-zero exit.

This is a bounded error-shaping change to one phase of `scripts/launch-workflow.mjs` plus its test. It is **not** a
launcher redesign and changes nothing about *what* the launcher is willing to tear down.

## Out of scope (halt-and-report if any becomes necessary)

- The workflow crash-path code (`workflows/forge-run-ticket.workflow.js`) — forbidden.
- The Core lock API and any Core surface — forbidden.
- Stale-lock recovery UX (force/clear of an orphaned lock) — separate, not this ticket.
- F1 role-output persistence — open/architectural, not this ticket.
- Any permission carve-out, a new cleanup ownership model, a launcher redesign, or worktree/shared-state work.
- Any change to *what* the launcher tears down, or to the ownership-verification rules.

## Discovery findings (inspected, not assumed; line numbers at the contract baseline)

1. **Ownership is verified before any teardown, and is correct.** `runCleanup` (`scripts/launch-workflow.mjs:384`)
   first checks namespace / strictly-under-OS-temp / not-inside-a-repo → `CLEANUP_REFUSED_NOT_FORGE_OWNED`
   (`:398-404`), then checks the on-disk ownership marker's `run_id` → `CLEANUP_REFUSED_NOT_FORGE_OWNED`
   (`:415-420`). Both run before the teardown and must stay unchanged.
2. **The gap is the unguarded teardown call.** `fs.rmSync(scratch, { recursive: true, force: true })` (`:421`)
   throws a raw `EPERM`/`EBUSY` when the scratch directory is still a live process's cwd (Windows). The throw
   escapes `runCleanup`, so the operator gets an untyped stack and a non-zero exit instead of guidance.
3. **A typed-failure vehicle already exists.** `fail(code, error)` (`:74-77`) emits `{ ok: false, code, error }`
   and exits 1 — the same shape the two `CLEANUP_REFUSED_NOT_FORGE_OWNED` paths use. `CLEANUP_BLOCKED` should reuse
   it for consistency.
4. **The success path is `:436-445`** — `{ ok: true, phase: "cleanup", run_id, removed_scratch_cwd, already_clean,
   evidence_paths, note, prevention_claim }` — and must stay byte-for-byte unchanged.

## Required behavior

- **Guard only the teardown.** Wrap the `fs.rmSync` teardown (`:421`) so a busy/locked failure is caught. The two
  ownership-verified refusals stay **before** it and unchanged; nothing about ownership or what gets torn down
  changes.
- **Map busy/locked to a typed result.** When the caught error's `code` is `EPERM` or `EBUSY`, emit a typed
  `CLEANUP_BLOCKED` result (via the existing `fail()` shape) carrying the blocked scratch path and the guidance
  **"Close the scratch-launched Claude session, then re-run cleanup."**
- **Never mask other failures.** An error whose `code` is neither `EPERM` nor `EBUSY` must **not** be reported as
  `CLEANUP_BLOCKED` and must **not** be swallowed — it propagates (or fails with a distinct shape). No broad
  catch-all.
- **Everything else unchanged.** `prepare`, `post-scan`, both `CLEANUP_REFUSED_NOT_FORGE_OWNED` refusals, and the
  successful-cleanup emit (incl. `removed_scratch_cwd` / `already_clean` / `prevention_claim`) are byte-for-byte
  unaffected.

## Required typed result

The `CLEANUP_BLOCKED` result must include:

- `ok: false`
- `code: "CLEANUP_BLOCKED"`
- `error` (or equivalent message field) containing **both**:
  - the blocked scratch path (posix form), and
  - the guidance string **"Close the scratch-launched Claude session, then re-run cleanup."**

## AI Instructions

- TDD: RED the cleanup error-shaping tests first in `src/workflows/launch-workflow.test.ts`. Make the busy/locked
  mapping unit-testable **without a live held directory** — factor the error classification into a pure helper
  (e.g. one that maps an error → the `CLEANUP_BLOCKED` shape for `EPERM`/`EBUSY`, and signals "not handled" for any
  other code), placed between sentinel comments so a source-level test can **extract and execute** it (the
  established launcher / workflow pattern), exercising `EPERM`, `EBUSY`, and a non-busy error.
- Keep the change surgical and additive; the existing launcher tests (prepare / post-scan / ownership) must stay
  green unmodified.
- Do not touch the workflow crash-path code, Core, the charters, the hook, or the other scripts.
- `pnpm test` and `pnpm typecheck` green; scope guard clean.

## Acceptance Criteria

1. An **`EPERM` during the cleanup teardown maps to a typed `CLEANUP_BLOCKED`** result.
2. An **`EBUSY` during the cleanup teardown maps to a typed `CLEANUP_BLOCKED`** result.
3. `CLEANUP_BLOCKED` **includes the blocked scratch path**.
4. `CLEANUP_BLOCKED` **includes close-session / re-run-cleanup guidance** ("Close the scratch-launched Claude
   session, then re-run cleanup.").
5. The **`CLEANUP_REFUSED_NOT_FORGE_OWNED` refusals remain unchanged** (both the namespace/temp/repo check and the
   marker-`run_id` check).
6. **Successful cleanup behavior remains unchanged** (the `ok: true` emit incl. `removed_scratch_cwd`,
   `already_clean`, `prevention_claim`).
7. **`prepare` and `post-scan` paths remain unchanged.**
8. **No broad catch masks non-busy failures** — an error whose `code` is neither `EPERM` nor `EBUSY` is not
   reported as `CLEANUP_BLOCKED` and is not swallowed.
9. Tests are **non-tautological** and exercise the real error-shaping (extract-and-execute the classifier; cover
   `EPERM`, `EBUSY`, and a non-busy error), and are **genuinely RED before** the change.
10. `pnpm test` and `pnpm typecheck` pass; scope guard clean (only `allowed_paths` change).

## Verification

- RED→GREEN evidence for the cleanup error-shaping tests; full `pnpm test` / `pnpm typecheck`.
- Governed two-pass verifiers review the diff for additivity + the no-masking invariant; PM judges.
- **No live held-directory repro is a gate** — the `EPERM` was already observed during the F1/F2 sequence, and the
  failure shaping is unit/protocol-testable.
- **No install refresh** post-merge: neither `scripts/launch-workflow.mjs` nor `src/workflows/launch-workflow.test.ts`
  is installed by `install-commands` (this ticket does not touch `commands/**` or `README.md`).

## Ratified decisions (PM — Dan, 2026-06-14)

1. **`risk` → `medium` (RATIFIED).** Filesystem cleanup semantics deserve caution even though the change is
   additive error-shaping.
2. **`blast_radius` → `module` (RATIFIED).** The nearest valid `BlastRadiusEnum` value to the intended single
   module.
3. **`allowed_paths` → narrowed (RATIFIED).** The implementation fence is exactly `scripts/launch-workflow.mjs`,
   `src/workflows/launch-workflow.test.ts`, and this epic's docs — **not** a broad `src/workflows/**`. The
   error-classifier lives in the launcher `.mjs` and is extract-and-executed from there, so no other
   `src/workflows/**` file changes.
4. **`CLEANUP_BLOCKED` transport → reuse the existing `fail()` shape (RATIFIED).** `ok:false` / `code` / `error`,
   exit 1 — consistent with the `CLEANUP_REFUSED_NOT_FORGE_OWNED` refusals.
