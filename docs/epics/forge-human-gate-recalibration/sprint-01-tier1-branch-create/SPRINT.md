# Sprint 01 — Tier 1: safe feature-branch creation

One ticket, the lowest-risk slice of the human-gate re-calibration:

- **T01** extends the permissions hook to ALLOW `git switch -c <safe-feature-branch>` (Tier 1 — mechanical, local,
  reversible). Additive ALLOW only; the proven deny engine, the Tier-3 destructive set, and the runner L3 backstop are
  untouched. Verified through the pure `decide()` self-check, RED-first.

Integration base: `main`. Gate `pr`, human push/merge, two-pass verification. No dependencies.
