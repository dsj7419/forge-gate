---
schema_version: 1
id: T01
title: Add the forge lock CLI surface and real defaultLockIo binding
kind: green
risk: high
change_class: feature
blast_radius: app
status: pending
depends_on: []
blocks: []
allowed_paths:
  - src/orchestrator/lock-cli.ts
  - src/orchestrator/lock-cli.test.ts
  - src/cli/run.ts
  - src/cli/run.test.ts
  - docs/epics/forge-lock-wiring/**
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - commands/**
  - workflows/**
  - agents/**
  - .claude/**
  - .github/**
  - package.json
  - pnpm-lock.yaml
  - README.md
  - docs/governance/**
  - "**/.forge/**"
  - src/cli.ts
  - src/orchestrator/lock.ts
  - src/orchestrator/decisions-ledger.ts
  - src/orchestrator/decisions-ledger.test.ts
  - src/orchestrator/ledger-cli.ts
  - "src/orchestrator/decision-id*"
  - "src/orchestrator/packets*"
  - "src/orchestrator/dispatch*"
  - "src/orchestrator/pm-dispatch*"
  - "src/orchestrator/index*"
  - src/run-report/**
  - src/schema/**
  - sandbox-epic/**
  - pilot-local/**
---

# T01 — Add the forge lock CLI surface and real defaultLockIo binding

## Scope

Expose the shipped Core epic-lock primitive (`src/orchestrator/lock.ts`, merged in PR #34) as a deterministic,
fail-closed CLI surface: `forge lock acquire | release | status`, backed by a real `defaultLockIo` filesystem
binding. This is the prerequisite that makes the lock callable; a later slice wires it into the orchestrator
entrypoint as the primary cross-run serialization.

Follow the established adapter shape exactly: a new `src/orchestrator/lock-cli.ts` that exports `defaultLockIo` (the
real `fs` binding) and `runLock(args, io, lockIo)`, plus a `lock` route added to `runCli` behind an injected seam
(`RunCliOptions.lockIo ?? defaultLockIo`) — mirroring `forge ledger` (`ledger-cli.ts` + the `ledger` route) and
`forge run-report`. Tests drive `runLock` through an injected in-memory `LockIo`; one real-fs temp-dir test proves
`defaultLockIo`.

**The shipped lock primitive is not modified** — `lock.ts` is imported, not edited. If the work appears to need a
change to `lock.ts` or any other module outside `allowed_paths`, **stop and report it in `deviations`** — that is a
re-scope, not a workaround.

## Out of scope (halt-and-report if any becomes necessary)

- Wiring `commands/forge-run-ticket.md` (or any orchestrator) to call `forge lock` — the next slice.
- Workflow-backed runner wiring (`workflows/**`).
- Any assisted or forced clearing of a stale or foreign lock (a `--force` / `break` path) — stale-recovery UX is a
  later slice. This ticket's `status` only **reports** a stale verdict.
- Editing the shipped `lock.ts` primitive, the ledger modules, the schema, or `src/cli.ts`.
- Evidence-write ownership / `run_id` artifact enforcement.

## Carried-forward decisions (ratified — keep these true)

1. The **epic lock is the primary cross-run serialization guarantee**; this CLI surface is what makes that possible.
2. The **CAS ledger append remains defense-in-depth**.
3. The residual CAS re-check-to-rename window is acceptable **only when lock wiring serializes appends** (a later
   slice); document this where the acquire path is described.
4. No stale-recovery UX yet — `status` reports staleness; it never clears or steals a lock.
5. No workflow wiring.
6. No evidence ownership / `run_id` enforcement yet.

## Required CLI behavior

`forge lock <acquire|release|status> <epic-path> [...]` resolves the lock file deterministically at
`<epic>/.forge/lock.json` (same per-epic anchoring as the ledger; the path is caller-supplied, no worktree-aware
logic). All filesystem access goes through the injected `LockIo` seam; the command never bypasses it with direct
`node:fs` except inside `defaultLockIo`.

- **`forge lock acquire <epic> --run-id <id> --session-id <s> --ticket <t> --branch <b> --repo-root <r>`** — builds a
  `forge-lock/v1` record (filling `pid`, `host`, `acquired_ts`, `heartbeat_ts` internally) and calls `acquireLock`.
  - Free path → exit 0, prints the written record.
  - Collision → exit non-zero, prints `LOCK_HELD` with the current holder; the existing lock is **never overwritten**.
  - Malformed on-disk lock → exit non-zero, prints `LOCK_MALFORMED`; never clobbered.
- **`forge lock release <epic> --run-id <id>`** — calls `releaseLock`, owner-checked by `run_id`.
  - Matching `run_id` → exit 0 (lock cleared).
  - Foreign `run_id` → exit non-zero, prints `LOCK_FOREIGN` with the holder; lock left intact.
  - Absent lock → exit non-zero, prints `LOCK_ABSENT`.
  - Malformed → exit non-zero, `LOCK_MALFORMED`; never clobbered.
- **`forge lock status <epic> [--heartbeat-ttl-ms <n>] [--acquire-ttl-ms <n>]`** — calls `staleVerdict` and prints the
  holder plus a fresh/stale verdict (with reasons + crossHost). No lock present → reports absent. **Report only — it
  never clears or steals.** A defaulted TTL is acceptable when the flags are omitted; document the defaults.
- **Fail-closed:** any malformed input or undecidable state exits non-zero with a typed code; nothing is
  auto-cleared, force-broken, or silently overwritten.

## Required `defaultLockIo` binding

Export `defaultLockIo: LockIo` from `lock-cli.ts` (mirroring `defaultDecisionsLedgerIo`):

- `createExclusive(file, contents)` → `fs.writeFileSync(file, contents, { flag: "wx" })` (O_EXCL); a colliding file
  yields `{ ok: false }` (map `EEXIST`), never overwriting. Create parent dirs as needed.
- `readFileIfExists(file)` → contents or `null` on `ENOENT`.
- `removeFile(file)` → `fs.rmSync(file, { force: true })` (used only on an owner-authorized release).

## Required router wiring

Add to `runCli` (`src/cli/run.ts`): `if (command === "lock") return runLock(argv.slice(1), io, options.lockIo ?? defaultLockIo);`
plus a `lockIo?: LockIo` field on `RunCliOptions`, the import, and a `forge lock ...` line in the `USAGE` string.
This mirrors the `ledger` and `run-report` routes exactly; no other router behavior changes.

## AI Instructions

- TDD: write the failing CLI test first for each behavior (acquire-free / acquire-held / acquire-malformed /
  release-owner / release-foreign / release-absent / release-malformed / status-fresh / status-stale / status-absent /
  usage-error), then implement.
- Determinism + fail-closed: every undecidable or malformed state exits non-zero with a typed code; never auto-clear,
  force-break, or overwrite a lock.
- Keep the injected-seam style: `runLock` takes a `LockIo`; tests pass an in-memory impl; `defaultLockIo` is the only
  place real `node:fs` is touched, proven by one real-fs temp-dir test (deterministic, cleaned up, no destructive op).
- Do not modify `lock.ts` (import its `acquireLock` / `releaseLock` / `staleVerdict` / `LockRecord` / `LockIo`). A
  needed change there is a halt-trigger reported in `deviations`.
- Run `pnpm test` and `pnpm typecheck`; both must stay green.

## Acceptance Criteria

1. **acquire-free:** `forge lock acquire` on a free epic writes a `forge-lock/v1` record and exits 0.
2. **acquire-held:** a second acquire while held exits non-zero with `LOCK_HELD` + the holder, and the existing lock
   file is **not overwritten**.
3. **acquire-malformed:** acquire against a malformed on-disk lock exits non-zero with `LOCK_MALFORMED`; no clobber.
4. **release-owner:** `forge lock release` with a matching `run_id` clears the lock and exits 0.
5. **release-foreign:** a non-matching `run_id` exits non-zero with `LOCK_FOREIGN`; the lock is left intact.
6. **release-absent / release-malformed:** absent → `LOCK_ABSENT` non-zero; malformed → `LOCK_MALFORMED` non-zero,
   never clobbered.
7. **status-report:** `forge lock status` prints the holder + a fresh/stale verdict (reasons + crossHost) and exits 0;
   absent → reports absent. It never clears or steals a lock.
8. **fail-closed:** malformed/undecidable input exits non-zero with a typed code; nothing auto-cleared or overwritten.
9. **defaultLockIo binding:** a real-fs temp-dir test proves `createExclusive` returns ok then `{ok:false}` on a
   collision (no overwrite), `readFileIfExists` returns contents/`null`, and `removeFile` clears the file — no leftover
   files, deterministic, no destructive op on the repo.
10. **router:** `forge lock` is routed in `runCli` behind `options.lockIo ?? defaultLockIo`; `USAGE` lists it; an
    invalid `forge lock <bad>` is a usage error.
11. **primitive untouched:** `src/orchestrator/lock.ts` is unchanged (imported, not edited).
12. **scope:** only `allowed_paths` are modified; `commands/**`, `workflows/**`, `agents/**`, `.claude/**`,
    `src/cli.ts`, the ledger/schema/run-report modules, and the other `src/orchestrator/*` modules are untouched.
13. `pnpm test` passes (existing suite plus the new lock-cli tests). `pnpm typecheck` passes.

## Verification

- Deterministic CLI-level tests through an injected in-memory `LockIo` for every acquire/release/status branch and
  the usage error.
- One real-fs temp-dir test for `defaultLockIo` (exclusive create + collision + read + clear), cleaned up.
- No orchestrator/workflow wiring; no stale-recovery/force-break path; no real lock taken on the live repo; no
  destructive operation. `pnpm test` + `pnpm typecheck` green; governed two-pass verifiers review diff + proof; PM
  judges.
