# Epic — Typed CLEANUP_BLOCKED for launcher cleanup when the scratch cwd is still held (F3)

## Why

`scripts/launch-workflow.mjs cleanup` tears down the Forge-owned per-run OS-temp scratch launch directory as a
hygiene step. On Windows, when that scratch directory is still held open as the current working directory by a live
scratch-launched Claude session, the `fs.rmSync` teardown throws a raw `EPERM` (or `EBUSY`) that escapes
`runCleanup`, surfacing as an untyped stack trace and a non-zero exit.

This is **F3** from the launch-cwd operability run (`wf_0c098781-275`) and was re-confirmed during the F1 spike:
the operationally-correct sequence is *close the scratch-launched session first, then run cleanup*, but the tool
gives the operator a raw OS error instead of that guidance. The desired behavior is **typed and actionable**: a
`CLEANUP_BLOCKED` result that names the blocked path and tells the operator to close the scratch-launched session
and re-run cleanup.

## What

When the scratch-dir teardown fails because the Forge-owned scratch launch directory is still busy/locked
(`EPERM`/`EBUSY`), the launcher must emit/return a typed `CLEANUP_BLOCKED` result — carrying the blocked path and a
close-session-then-retry hint — instead of a raw error stack. This is a small error-shaping change confined to the
launcher's cleanup phase. It is **not** a launcher redesign and changes nothing about *what* the launcher is
willing to clear.

## Scope discipline

A narrow UX/error-shaping fix to one launcher phase plus its test. Every existing safety property is preserved
byte-for-byte: the two ownership-verified `CLEANUP_REFUSED_NOT_FORGE_OWNED` refusals, the prepare/create path, the
post-scan path, and the successful-cleanup emit all stay unchanged. Only the *failure shape* of the teardown
changes, and only for the busy/locked case — any other error must not be masked.

Explicitly out of this epic: the workflow crash-path code (`workflows/forge-run-ticket.workflow.js`), the Core lock
API, stale-lock recovery UX, the F1 role-output persistence seam, permission carve-outs, any new cleanup ownership
model, and any worktree/shared-state architecture.

## Tickets

- **T01** — Typed `CLEANUP_BLOCKED` for launcher cleanup `EPERM`/`EBUSY`.

## Claude Code Substrate Review

- **Launcher (operator tooling):** `scripts/launch-workflow.mjs` is a standalone Node script the operator runs
  outside the workflow; its `cleanup` phase is the only place that tears down the scratch cwd, so it is the only
  place this raw-error shape can surface. The fix is local to `runCleanup`'s teardown call.
- **Forge Core (governance):** unchanged. No Core surface is touched; the launcher never imports Core.
- **The substrate failure being handled:** on Windows a directory cannot be torn down while it is a live process's
  cwd (`EPERM`/`EBUSY`). F3 does not try to force the teardown or change ownership semantics — it converts the
  busy/locked failure into a clean, typed, actionable terminal. This is graceful error shaping, not a retry loop.
- **Tests:** the busy/locked case is unit/protocol-testable without a live held directory — extract the pure
  error-classifier from the launcher source and execute it against synthetic `EPERM`/`EBUSY` and non-busy errors
  (the established launcher/workflow extract-and-execute pattern). **No live repro is a gate** for this ticket; the
  real `EPERM` was already observed during the F1/F2 sequence.
