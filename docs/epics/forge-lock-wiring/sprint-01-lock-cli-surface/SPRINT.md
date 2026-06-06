# Sprint 01 — Lock CLI surface

One ticket: expose the shipped Core epic-lock primitive as a `forge lock acquire | release | status` CLI surface,
backed by a real `defaultLockIo` filesystem binding (exclusive-create acquire, owner-checked release, report-only
stale verdict), wired into the CLI router behind an injected seam — mirroring `forge ledger` / `forge run-report`.

- **T01** — Add the `forge lock` CLI surface and real `defaultLockIo` binding.

Acceptance evidence is deterministic CLI-level tests behind an injected `LockIo` (acquire-free / acquire-held
`LOCK_HELD` no-overwrite / owner release / foreign release refused / malformed refused / absent / status stale
verdict) plus one real-fs temp-dir test for `defaultLockIo`. No orchestrator/workflow wiring; no stale-recovery UX;
no real lock is taken on the live repo and no destructive operation is run.
