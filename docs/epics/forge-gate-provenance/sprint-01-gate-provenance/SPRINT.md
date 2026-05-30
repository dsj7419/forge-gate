# Sprint 01 — Core-owned gate provenance

**Epic:** forge-gate-provenance
**Status:** active
**Integration base:** main

## Goal

Make the effective gate flow Core-file to Core-file: the Core-emitted active-ticket carries the gate,
`run-report write` reads it as the source of truth, and the `--gate-*` flags become optional cross-checks
only. Close the seam without touching the frozen run-report schema or the packet generator.

## Tickets

- **T01** — Make the effective gate flow Core-file to Core-file (active-ticket carries the gate; run-report
  reads it; flags are cross-checks).
