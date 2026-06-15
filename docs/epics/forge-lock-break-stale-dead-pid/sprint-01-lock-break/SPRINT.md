# Sprint 01 — lock-break

Goal: add a human-gated `forge lock break` that clears an orphaned epic lock **only** when the holder is provably
dead on the same host, the operator echoes the holder `run_id` and passes `--yes`, and a re-read immediately before
the clear confirms the holder is unchanged — with a printed (and preferably persisted) audit record. v1 is same-host
provable-death only; TTL-only, cross-host, and the heartbeat updater are deferred.

Tickets:
- T01 — Human-gated lock break for same-host stale `dead_pid`.
