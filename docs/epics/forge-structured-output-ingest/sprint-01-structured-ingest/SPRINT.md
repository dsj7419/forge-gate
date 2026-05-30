# Sprint 01 — structured-output agent ingest

One ticket: port the four role-output schemas to `zod/v4` (so they can also emit JSON Schema), add a
source-agnostic `src/agents/ingest.ts` adapter (structured object OR YAML → the same role-schema
`safeParse`), add `forge parse-agent --json-file/--json-stdin` structured modes and a
`forge agent-schema <role>` emitter, and preserve the YAML fallback and the PM decision-id cross-check.

**Done means:** T01's Acceptance Criteria are met, both verifiers APPROVE, `pnpm test` + `pnpm typecheck`
are green, and the run stops at the commit gate for a human.

**Halt-triggers:** any change outside T01's `allowed_paths`; any edit to `src/schema/**` (especially
`enums.ts` — it stays Zod 3); any edit to `src/run-report/**` (source tracking is Phase 1c); any
`package.json`/`pnpm-lock.yaml` change (the `zod/v4` subpath resolves from the installed version); any
charter (`agents/**`) or command (`commands/**`) edit; any change to the existing `parse-agent` YAML
modes or router behavior beyond the additive structured modes + the new `agent-schema` command; any
weakening of the YAML path or its tests; a failing verify command after the correction cap.
