# Closeout — Human-gated stale-lock recovery (`forge lock break`)

**Status: SHIPPED (v1).** Forge now has a **human-gated `forge lock break`** recovery path for a same-host stale
lock whose holder PID is **provably dead**. It preserves the load-bearing invariant: **a fresh / live lock cannot
be broken.** This closes the stale-lock recovery gap that remained after F2 (graceful crash release): an orphan
left by hard process death (kill / crash / power loss) now has a governed, conservative clear path — where before
the only options were owner-keyed `release` (which would clear a *live* lock if you supplied its id) or a raw file
teardown.

## Landing facts

| Field | Value |
|---|---|
| main SHA | `745cdef` |
| Contract PR | #69 (squash `db998fa`) |
| Implementation PR | #70 (squash `745cdef`) |
| Decision | **D-001 PASS** |
| Post-merge `pnpm test` | **764 passed / 44 files** |
| `pnpm typecheck` | clean |
| `validate` | OK — 0 findings |
| `run --dry-run` | READY → T01 (expected — ticket `status:` stays `pending` on disk; deliberate no-write-back) |

**Changed files (implementation):**
- `src/orchestrator/lock.ts`
- `src/orchestrator/lock.test.ts`
- `src/orchestrator/lock-cli.ts`
- `src/orchestrator/lock-cli.test.ts`

## Design summary

- New pure **`breakStaleLock`** primitive (`lock.ts`) and new **`forge lock break`** CLI route (`lock-cli.ts`,
  `runBreak`), wired inside `runLock` with an injected/defaulted `LockClock` so `src/cli/run.ts` stays untouched.
- **Same-host `dead_pid` is the only v1 break authority** (`process.kill(pid, 0)` → `ESRCH`). The aged-heartbeat /
  acquire-TTL signals never authorize a break — no heartbeat updater exists, so an aged heartbeat does not prove death.
- **Fresh / live locks refuse** (`LOCK_NOT_STALE`). **TTL-only stale refuses**, **heartbeat-only stale refuses**,
  **cross-host stale refuses** (all → `LOCK_LIVENESS_UNPROVEN`).
- The operator must pass **`--confirm-run-id <holder-run-id>` and `--yes`** (mismatch → `LOCK_CONFIRM_MISMATCH`).
- **Preview mode is non-mutating** (`forge lock break <epic>` without `--yes` reports holder / reasons /
  breakability and clears nothing).
- **CAS re-read happens before the lock clear**; a **holder-change race aborts** (`LOCK_CHANGED`, clears nothing).
- **Malformed lock refuses** (`LOCK_MALFORMED`, never clobbered).
- **`release --run-id` remains unchanged**; **`status` remains report-only**.
- **Printed audit output is present** (epic path, holder run_id / pid / host, stale reasons, action `break`,
  timestamp, result). **Persisted audit remains deferred** (printed-only, no new IO seam).
- **Heartbeat updater remains deferred. TTL-only and cross-host break remain deferred.**

## Evidence summary

- Governed `/forge-run-ticket` self-run reached **PASS at the commit gate** (orchestrator never committed).
- Semantic verifier **APPROVE**; scope verifier **APPROVE**; PM **PASS** (D-001).
- Decisions ledger: **D-001 appended** (before the run-report write).
- Run-report `safety.*` all **false** (committed / pushed / pr_opened / merged / status_write_back / journal_written).
- Epic lock **acquired then released owner-checked** (`run_id 47e67307-…`, release `{ok:true}`).
- Deterministic scope **guard OK** (exit 0); changed files exactly the 4 allowed lock files.
- CI green on the implementation commit; post-merge verification on `main`: 764/44 tests, typecheck clean,
  validate 0 findings, dry-run READY.
- **The fresh / live-lock refusal negative test was the hard gate** — verified by both verifiers, the PM, and an
  independent diff read of `breakStaleLock`.

## Strategic carry-forward

- **Lock-break v1 is shipped.**
- **Heartbeat updater is not part of v1.**
- **TTL-only and cross-host recovery remain deferred.**
- **F1** (role-output persistence) **remains open / architectural** and requires an **in-context proof plan**
  before any implementation (no permission carve-out).
- **Status hygiene** remains a deliberate **leave-it** decision unless it becomes materially misleading.
- **No permission carve-out** anywhere in this arc.
- **Next action: a deliberate frontier decision, not automatic implementation.**
