# Sprint 01 — charter YAML hardening

One ticket: add block-style + quoting YAML-output rules and block-style examples to the four agent charters,
plus a charter-format enforcement test and a characterization test that locks in Core's strict rejection of the
fragile flow-style-with-unquoted-comma shape.

**Done means:** T01's Acceptance Criteria are met, both verifiers APPROVE, `pnpm test` + `pnpm typecheck` are
green, and the run stops at the commit gate for a human.

**Halt-triggers:** any change outside T01's `allowed_paths`; any change that loosens `parse-output.ts` /
`schemas.ts` / `index.ts` (Core must stay strict); altering which output fields are required (only the YAML
style + rule text may change); a failing verify command after the correction cap.
