# Epic — Run-report agent-output source tracking

**Status:** active
**Integration base:** main

## Why

Discovery (`docs/1c-run-report-source-tracking-discovery.md`) confirmed that `forge-run-report/v1` records
*what* each agent emitted and *that* it validated, but not *which evidence path produced it*. Today there is
one path (YAML/text captured to `.forge/<role>-output.yaml`). Phase 1 added a structured-JSON ingest path
(`src/agents/ingest.ts`), and Phase 2 will add a deterministic workflow/core-runner capture path. Once more
than one evidence path exists, a PASS report that cannot say which path produced each output is
under-instrumented for audit.

A key discovery finding shapes the design: `forge run-report write` re-reads the captured
`.forge/<role>-output.yaml` files as YAML regardless of the original upstream source (`src/run-report/cli.ts`),
so the source **cannot be truthfully derived** at write time. It must be **explicit runtime metadata** supplied
by the orchestrator — exactly how `notes` and `commit_gate_materials` already flow.

This epic adds an **additive, optional** `agent_output_source` field to `forge-run-report/v1` so reports record
the evidence path per role, **without weakening the v1 safety thesis** (`safety.*` and
`final_branch_status.committed` stay `z.literal(false)`; top-level stays `.strict()`; no `v2` bump).

## What

- Add an optional, strict, per-role `agent_output_source` field to `forge-run-report/v1`.
- Three-value **trust-path** enum: `yaml_text | structured_json | workflow_core_runner`. The third value is a
  reserved future value (Phase 2 workflow/core-runner capture) — the schema accepts it now so the frozen
  schema is not re-opened when the runner lands; nothing in Phase 1c emits it.
- Plumb the field as explicit optional `RuntimeMetadata` through the pure assembler, supplied by optional
  per-role flags on `forge run-report write`. Entire change stays inside `src/run-report/**`.

## Out of scope

- Any change to `src/orchestrator/**` (including `OrchestratorConfirmedFacts`) — source is supplied as
  run-report runtime metadata, not threaded through the facts schema.
- Any change to `src/agents/**` (`ingest.ts`/`schemas.ts`/`parse-output.ts` are untouched; the run-report enum
  is a separate human-facing provenance label).
- Any change to `commands/forge-run-ticket.md` or the charters (`agents/**`).
- Deriving source from the captured `.forge/*-output.yaml` files (the discovery finding: it would be a lie).
- A `forge-run-report/v1` → `v2` bump; emitting `workflow_core_runner` (Phase 2 work); the workflow runner.

## Sprints

- **sprint-01-source-tracking** — T01: add run-report agent-output source tracking.
