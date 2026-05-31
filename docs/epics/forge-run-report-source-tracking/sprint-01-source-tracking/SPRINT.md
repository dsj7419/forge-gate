# Sprint 01 — Run-report agent-output source tracking

**Epic:** forge-run-report-source-tracking
**Status:** active
**Integration base:** main

## Goal

Add an additive, optional, per-role `agent_output_source` field to `forge-run-report/v1` so a report records
which evidence path produced each agent output (`yaml_text | structured_json | workflow_core_runner`). The
field is explicit orchestrator-supplied runtime metadata, plumbed through the pure assembler and optional CLI
flags, with the entire change fenced inside `src/run-report/**`. The v1 safety thesis is preserved.

## Tickets

- **T01** — Add run-report agent-output source tracking.

## Halt-triggers

Any change outside T01's `allowed_paths`; any change to `src/orchestrator/**` (including
`OrchestratorConfirmedFacts`); any change to `src/agents/**`; any edit to `commands/**` or `agents/**`; any
weakening of the top-level `.strict()`, any `safety.*` literal, or `final_branch_status.committed`; a
`forge-run-report/v1` → `v2` schema bump; deriving source from the captured `.forge/*-output.yaml` files; a
failing verify command after the correction cap.
