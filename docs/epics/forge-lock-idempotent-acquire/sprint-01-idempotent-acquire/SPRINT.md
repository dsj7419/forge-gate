# Sprint 01 — idempotent acquire

One ticket: make `acquireLock` idempotent for the same owner (`run_id`) in the Core lock primitive, locked by
unit tests against the real primitive.

- **T01** — Make `forge lock acquire` idempotent for the same owner.
