---
schema_version: 1
id: T01
title: Add Core epic-lock primitive and atomic decisions-ledger append
kind: green
risk: high
change_class: feature
blast_radius: app
status: pending
depends_on: []
blocks: []
allowed_paths:
  - src/orchestrator/lock.ts
  - src/orchestrator/lock.test.ts
  - src/orchestrator/decisions-ledger.ts
  - src/orchestrator/decisions-ledger.test.ts
  - src/orchestrator/ledger-cli.ts
  - docs/epics/forge-cross-run-concurrency/**
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
  - src/cli/run.ts
  - src/cli.ts
  - src/run-report/**
  - src/schema/**
  - src/orchestrator/decision-id.ts
  - src/orchestrator/packets.ts
  - src/orchestrator/dispatch.ts
  - src/orchestrator/pm-dispatch.ts
  - src/orchestrator/index.ts
  - sandbox-epic/**
  - pilot-local/**
---

# T01 — Add Core epic-lock primitive and atomic decisions-ledger append

## Scope

Close the two most dangerous cross-run invariants identified in `docs/cross-run-concurrency-discovery.md`
(PR #32): **exclusive run ownership** and **non-duplicating / non-clobbering PM decisions**. This ticket adds a
**Core epic-level lock primitive** and makes the **decisions-ledger append atomic**. Both are Core modules with
injected IO seams, in the same single-purpose style as the existing `DecisionsLedgerIo`/`InstallReader` seams.

This is a Core-internal foundation slice. It wires **nothing** into the orchestrators, the CLI router, or the
workflow runner, and it changes no other Core behavior. If the work appears to need a change outside the
`allowed_paths`, **stop and report it in `deviations`** — that is a re-scope, not a workaround.

## Out of scope (halt-and-report if any becomes necessary)

- Evidence-write ownership over `run-report.json` / `active-ticket.json` / `orchestrator-facts.json`.
- Orchestrator command wiring (`commands/forge-run-ticket.md`) or workflow wiring (`workflows/**`).
- Exposing a `forge lock` CLI subcommand or any `src/cli/**` change (a later wiring slice).
- Stale-lock recovery UX beyond safe detection and a reportable verdict.
- Per-run worktrees; the multi-worktree shared-state location problem.
- The real OS-level two-process race proof (a later wiring/integration slice may add it).

## Ratified PM decisions (2026-06-03)

1. **Physical location.** Lock and ledger state are anchored to the canonical repo-root / canonical epic `.forge`.
   Do **not** solve the multi-worktree shared-state location here. The lock primitive accepts the lock-file path
   from its caller (it does not invent worktree-aware path logic). Document plainly: **worktree isolation remains
   unsafe for shared decision provenance** until a stable, non-worktree-fragmented shared-state location exists.
2. **`run_id`.** Introduce `run_id` in the lock schema now, used for lock ownership, diagnostics, and future
   evidence ownership. Do **not** require `run_id` ownership on every evidence artifact in this slice.
3. **Serialization model.** Serialize by lock for now; do **not** require per-run worktrees.
4. **Ticket scope.** Only the Core lock primitive (atomic exclusive create) and the atomic/CAS ledger append.

## Part A — Core epic-lock primitive (`src/orchestrator/lock.ts` + `lock.test.ts`)

A typed `forge-lock/v1` record and a pure decision surface behind an injected IO seam:

- **Lock record schema** (Zod, inline in `lock.ts`, mirroring the ledger's inline schema): includes at least
  `run_id`, plus identity/diagnostic fields (`session_id`, `pid`, `host`, `epic_path`, `ticket`, `branch`,
  `repo_root`, `acquired_ts`, `heartbeat_ts`). `run_id` is mandatory.
- **Acquire** is an **atomic exclusive create**: the create itself is the mutual exclusion (no check-then-write).
  The IO seam exposes an exclusive-create operation that fails when the target already exists; the primitive maps
  that collision to a typed `LOCK_HELD` result carrying the current holder, and **never overwrites** the existing
  lock. Acquire when no lock exists succeeds and writes the typed record.
- **Release** succeeds only when the caller's `run_id` matches the on-disk holder's `run_id`; a non-matching
  (foreign) `run_id` is refused with a typed result and the lock file is left intact.
- **Read / inspect** parses the on-disk record; a malformed lock file is refused safely (typed error, no clobber).
- **Stale detection** returns a typed verdict (fresh vs stale) computed from holder liveness signals
  (same-host dead `pid`, expired `heartbeat_ts`, exceeded acquire TTL). The primitive **reports** staleness; it
  **never auto-clears or steals** a lock. Cross-host `pid` liveness is treated as unverifiable, so a cross-host
  verdict leans on heartbeat / TTL only.
- The primitive is **pure + seam-injected** like the ledger: tests run against in-memory state. The real `fs`
  binding (exclusive create via `O_EXCL`/`wx`, atomic rename) and any CLI exposure are a **deferred wiring slice**;
  this ticket delivers the primitive and its tests only.

## Part B — Atomic / CAS decisions-ledger append (`src/orchestrator/decisions-ledger.ts` + `ledger-cli.ts`)

Make `appendDecision` safe against a concurrent appender so a `decision_id` can never duplicate or clobber another,
**even if the lock is bypassed** (defense in depth, independent of Part A):

- The append must be atomic at the write boundary — re-establish the expected id against the on-disk state and
  commit via an all-or-nothing write (for example an exclusive-create temp file plus an atomic rename), so an
  interleaved second appender cannot lose-update or duplicate. Extend the `DecisionsLedgerIo` seam as needed and
  provide the real atomic binding in `ledger-cli.ts`.
- The existing read-layer and append-layer integrity rules (unique + strictly-increasing ids; appended id must
  equal `nextDecisionId(existing)`) are **preserved** — the per-attempt `D-001` reuse semantics across separate
  attempt ledgers stay intact.
- **No behavior change for the single-run path:** with no contention the result is byte-identical to today, and the
  existing ledger tests stay green.

## AI Instructions

- TDD: write the failing unit test first for each behavior (acquire, contention, release, foreign-release,
  malformed, stale-verdict, schema-includes-`run_id`; ledger no-duplicate, no-clobber, schema-valid-after-contention).
- Determinism is the product: the lock and ledger logic must be deterministic and **fail closed**. No hidden
  auto-clear, no silent overwrite, no improvised metadata.
- Prove concurrency with an **injected-seam interleaving harness** (simulate the ordering read-A → read-B →
  write-A → write-B), **not** real sleeps or timers. A real-`fs` exclusive-create unit test in a temp directory MAY
  additionally assert the collision semantics deterministically, but no multi-process/timer-based test is required.
- Keep schemas strict (`.strict()`); validate at the trust boundary; never weaken an existing schema or test.
- Touch only the `allowed_paths`. A needed change elsewhere is a halt-trigger reported in `deviations`.
- Run `pnpm test` and `pnpm typecheck`; both must stay green.

## Acceptance Criteria

1. **Acquire (free):** acquiring a lock when none exists succeeds and writes a typed `forge-lock/v1` record.
2. **Acquire (held):** a second acquire while a lock exists returns `LOCK_HELD` with the current holder and **does
   not overwrite** the existing lock file.
3. **No check-then-write:** acquisition relies on an atomic exclusive-create collision (not a separate existence
   check), proven by a test that a create against an existing lock surfaces `LOCK_HELD` with no overwrite.
4. **Release (owner):** release succeeds only when the caller's `run_id` matches the holder's `run_id`.
5. **Release (foreign):** a non-matching `run_id` release is refused with a typed result and leaves the lock intact.
6. **Malformed lock:** a malformed / unparseable lock file is refused safely with a typed error and is never
   clobbered.
7. **Stale verdict:** a stale lock (dead same-host `pid`, expired `heartbeat_ts`, or exceeded TTL) is detected and
   returned as a reportable verdict; a live lock is never classified stale; nothing is auto-cleared or stolen.
8. **Schema:** the lock schema includes `run_id` (mandatory) and the identity/diagnostic fields; it is strict.
9. **Ledger no-duplicate:** under the simulated interleaving harness, `appendDecision` cannot produce a duplicate
   `decision_id`.
10. **Ledger no-clobber:** under the same harness, a concurrent append cannot lose-update (clobber) another run's
    appended decision.
11. **Ledger stays valid:** after every failed-contention case the on-disk ledger still satisfies
    `DecisionsLedgerSchema` (unique + strictly increasing in ledger order).
12. **Single-run unchanged:** existing single-run ledger tests remain green; no contention → byte-identical result.
13. **Interleaving harness exists** and drives the no-duplicate / no-clobber proofs via injected IO ordering, not
    real sleeps or timers.
14. **Anchoring documented:** the lock-file path is caller-supplied (canonical epic `.forge`), and the
    worktree-isolation-unsafe note is recorded in the epic docs.
15. **Scope:** only the `allowed_paths` are modified; `commands/**`, `workflows/**`, `agents/**`, `.claude/**`,
    `src/cli/**`, `src/run-report/**`, `src/schema/**`, and the other `src/orchestrator/*` modules are untouched.
16. `pnpm test` passes (existing suite plus the new lock + ledger tests). `pnpm typecheck` passes.

## Verification

- Deterministic unit tests behind injected IO seams for every lock behavior and every ledger contention case.
- At least one ledger-append **interleaving harness** asserting no-duplicate and no-clobber via injected ordering.
- No reliance on real sleeps/timers; no real destructive operation; no per-run worktree; no orchestrator/CLI/workflow
  wiring.
- `pnpm test` + `pnpm typecheck` green; the governed two-pass verifiers review diff + proof; PM judges.
