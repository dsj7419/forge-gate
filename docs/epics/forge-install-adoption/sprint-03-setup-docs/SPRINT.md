# Sprint 03 — setup docs

One ticket: document the Dan-local and public GitHub setup workflows now that the install → verify loop is
real, plus the epic-placement adoption model, a corrected read-only-wrapper note, and the v1 boundaries.

**Done means:** T03's Acceptance Criteria are met, both verifiers APPROVE, `pnpm test` + `pnpm typecheck` are
green, and the run stops at the commit gate for a human.

**Halt-triggers:** any change outside T03's `allowed_paths` (docs-only); any code/script/config edit; any
documentation of automation that does not exist (hooks, doctor, init-target, installer/plugin as live features).
