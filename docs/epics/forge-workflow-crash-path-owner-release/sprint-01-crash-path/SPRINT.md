# Sprint 01 — crash-path

Goal: make an unhandled post-acquire workflow failure release the epic lock owner-checked and emit a typed
terminal outcome, instead of orphaning the lock.

Tickets:
- T01 — Crash-path owner-checked release on unhandled workflow failure.
