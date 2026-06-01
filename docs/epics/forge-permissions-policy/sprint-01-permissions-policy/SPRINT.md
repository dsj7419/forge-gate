# Sprint 01 — Permissions-policy refinement

One ticket: replace the broad static deny with a hook-backed policy that judges command intent (allow reversible
PR workflow, refuse destructive operations, require explicit human approval for a merge), and harden the
`forge-core-runner` charter so the runner's no-outward-action guarantee never depends on a broad project-level
deny alone.

- **T01** — Add hook-backed permissions policy preserving runner no-outward-action.

Acceptance evidence is a demonstrable hook self-check: the reversible PR-workflow commands are permitted, the
destructive / bypass / merge-without-approval commands are refused, and the hook fails closed (refuse on error).
No Forge Core change; no real destructive operation is ever executed to prove this.
