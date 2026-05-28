# ForgeGate — agent output hardening

Make the agent roles emit schema-valid structured output reliably, so Core's strict parser accepts valid work
on the first pass instead of halting on avoidable YAML-formatting fragility.

- **Goal:** close the inline-flow-mapping fragility surfaced by the DanJohnsonSite pilot — charters taught agents
  inline flow-style YAML, which breaks when a value contains a comma/colon/etc. Harden the charter templates and
  lock the format with tests; keep Core strict.
- **Non-goals:** loosening the parser or schemas; improving parser error messages; any feature work.
- **Constraints:** human-gated; one ticket at a time; the run stops at the commit gate; the engineer edits only
  the ticket's `allowed_paths`. Core's parser/schemas are correct and out of bounds for this work.

## Sprints

- `sprint-01-charter-yaml` — block-style + quoting rules across the four charters, plus enforcement +
  characterization tests (T01).

> Self-run note: this epic edits ForgeGate's own charters and tests; drive it with a frozen build
> (`pnpm build` then `FORGE_BIN="node <repo>/dist/cli.js"`). The run's verifiers read the charter files live,
> so they benefit from the in-run edits — a one-time block-style re-dispatch may still be needed mid-run until
> this lands.
