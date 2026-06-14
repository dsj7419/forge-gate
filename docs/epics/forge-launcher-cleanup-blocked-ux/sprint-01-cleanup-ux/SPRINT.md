# Sprint 01 — cleanup-ux

Goal: make the launcher's cleanup phase surface a typed, actionable `CLEANUP_BLOCKED` result (with the blocked path
and a close-session-then-retry hint) when the Forge-owned scratch launch directory is still busy/locked, instead of
a raw `EPERM`/`EBUSY` stack — preserving every existing cleanup safety property.

Tickets:
- T01 — Typed `CLEANUP_BLOCKED` for launcher cleanup `EPERM`/`EBUSY`.
