# Epic — Core-owned gate provenance

**Status:** active
**Integration base:** main

## Why

Forge Core computes the effective gate during `packets` / dry-run and already carries it on
`ActiveRun.gate`. But `buildActiveTicket` drops it, so the only gate the run-report writer ever sees is
the orchestrator-supplied `--gate-*` flags. Core therefore cannot independently prove those flag values
came from its own derivation — and a buggy or future workflow orchestrator could feed the PM's own
`human_gate_required` value back through `--gate-human-required`, making the `HUMAN_GATE_MISMATCH`
cross-check tautological (the relocated PR #6 risk).

This epic makes the gate flow Core-file to Core-file: the Core-emitted `active-ticket.json` becomes the
single source of truth for the gate, and the flags become optional cross-checks only.

## What

Persist the Core-derived gate in the active-ticket artifact, have `run-report write` source the effective
gate from `active-ticket.gate`, and downgrade `--gate-*` to optional cross-checks. A disagreeing flag
returns `GATE_PROVENANCE_MISMATCH`; an active-ticket with no gate returns `GATE_SOURCE_MISSING`
(pure-strict — there is no flag fallback, because the active-ticket artifact is regenerated for every
compliant run). `HUMAN_GATE_MISMATCH` keeps its meaning but now compares the PM output against the
Core-sourced gate.

## Sprints

- **sprint-01-gate-provenance** — Core-owned gate provenance (active-ticket carries the gate; run-report
  reads it; flags become cross-checks).

## Out of scope

- The workflow runner itself (Phase 2b).
- Decision-id assignment provenance (Phase B2, a separately-scoped ticket).
- Run-report `agent_output_source` tracking (Phase 1c, a separately-scoped ticket).
- Any change to the frozen `forge-run-report/v1` schema.
- Editing the Markdown command (it stays compatible without edits; a doc cleanup is a later follow-up).
- Any auto-commit / auto-push / PR / merge behavior.
