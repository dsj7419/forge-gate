# Epic — Human-gated lock break for a same-host stale dead-PID holder

## Why

F2 (#63/#66 family) made the workflow release its epic lock owner-checked on a **handled** crash. The remaining
recovery gap is an **unhandled** death — a hard `kill`, machine crash, power loss, or terminated session — that
leaves `<epic>/.forge/lock.json` orphaned. Forge can already *detect* this (`forge lock status` runs `staleVerdict`
and reports a stale verdict) but there is **no governed, human-gated path to clear an orphaned lock**. Today the
only options are `release --run-id <holder-id>` (which will clear a lock whose id you supply **even if that run is
alive**) or a raw file teardown — neither confirms death, neither leaves an audit trail.

## The decisive constraint (from the design packet)

`heartbeat_ts` is written **once at acquire** and there is **no heartbeat updater** — so a healthy long-running
governed run keeps its original heartbeat and would be flagged "stale" by the heartbeat TTL within minutes. Therefore
**an aged heartbeat / acquire-TTL does NOT prove death** and must never authorize a break on its own. The only
*provable-death* signal available today is a **same-host dead PID** (`process.kill(pid, 0)` → `ESRCH`). Cross-host
PID liveness is unverifiable. This bounds v1.

## What

Add a **human-gated** `forge lock break` command that clears an orphaned lock **only** when the holder is provably
dead on the same host, the operator explicitly echoes the holder's `run_id`, and the lock is re-read immediately
before clearing to confirm the holder has not changed. Detection reuses the existing `staleVerdict`; this epic adds
only the **gated clear** plus confirmation and an audit record. It is a conservative lock-safety surface — operator
convenience never outranks live-lock safety.

## Scope discipline

A focused Core change to the lock primitive and its CLI plus tests. v1 is **same-host provable-death only**: no
TTL-only break, no cross-host break, no heartbeat updater (all deferred). `acquire` / `release` / `status` semantics
are unchanged. No workflow / launcher / charter / hook change. Design rationale and the full invariant set live in
`.forge/stale-lock-recovery-design-packet.md`.

## Tickets

- **T01** — Human-gated lock break for same-host stale `dead_pid`.

## Claude Code Substrate Review

- **Forge Core (governance):** the change lives in `src/orchestrator/lock.ts` (a new pure `breakStaleLock`) and its
  CLI adapter `src/orchestrator/lock-cli.ts` (a new `break` subcommand). The `lock` route in `src/cli/run.ts`
  already delegates to `runLock`, so no router change is needed and `run.ts` is out of scope.
- **The recovery is human-only:** `break` is never invoked by the workflow runner, the command orchestrator, or any
  crash handler. It is an operator CLI action, loud and audited.
- **Safety stays in code:** the "never break a live lock" guarantee is enforced by the dead-PID gate + the
  re-read-before-clear (CAS) check + explicit `--confirm-run-id`/`--yes`, not by documentation.
- **Tests:** unit-testable with the existing in-memory `LockIo` + injected `LockClock` (no real process needed);
  the headline test is the **negative** one — a fresh/live lock refuses to break. One real-fs CLI test mirrors the
  existing `defaultLockIo` real-fs test. No live workflow run is required.
