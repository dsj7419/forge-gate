# Sprint 01 — verify-install

One ticket: add the read-only `forge verify-install` command that reports whether the installed Claude
commands and agent charters match the current ForgeGate checkout.

**Done means:** T01's Acceptance Criteria are met, both verifiers APPROVE, `pnpm test` + `pnpm typecheck` are
green, and the run stops at the commit gate for a human.

**Halt-triggers:** any change outside T01's `allowed_paths`; any change to a `forbidden_paths` entry; any
behavior change to the install script, parser, guard, schema, validator, orchestrator, importer, or run
planner; a failing verify command after the correction cap.
