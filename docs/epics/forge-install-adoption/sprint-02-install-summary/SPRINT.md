# Sprint 02 — install summary

One ticket: improve the `pnpm install-commands` post-install summary so it guides the user into the
detect → remediate → confirm loop now that `forge verify-install` exists.

**Done means:** T02's Acceptance Criteria are met, both verifiers APPROVE, `pnpm test` + `pnpm typecheck` are
green, and the run stops at the commit gate for a human.

**Halt-triggers:** any change to `install-commands` copy behavior or installed file contents; any change outside
T02's `allowed_paths`; any added automation (auto-running verify, hooks); a failing verify command after the
correction cap.
