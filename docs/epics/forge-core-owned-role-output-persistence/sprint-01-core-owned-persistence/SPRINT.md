# Sprint 01 — Core-owned persistence

Two tickets implementing the Phase 1 structural fix for F1 (role-output persistence), in dependency order:

- **T01** adds the additive Core surface `forge parse-agent <role> --out <path>` (validate-then-write, `.forge`
  containment). Testable entirely in Core; no workflow change.
- **T02** moves the workflow's four role-output persists onto that surface and is gated on an in-context Phase 1
  proof before merge.

Integration base: `main`. Both tickets gate `pr`, human push/merge, two-pass verification. **T02 depends on T01.**
