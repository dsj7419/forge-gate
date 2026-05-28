# ForgeGate — Core-owned `forge-run-report/v1` writer

Make the runtime evidence artifact at `$EPIC/.forge/run-report.json` a Core-owned, typed, validated,
deterministic write — eliminating the field drift that comes from hand-authoring the JSON in the
orchestrator command, and baking the v1 safety thesis into Core's schema rather than docs alone.

- **Goal:** Core owns the `forge-run-report/v1` schema and the deterministic writer. The orchestrator
  command still decides WHEN to call it; Core decides WHAT it looks like and refuses anything that
  violates the v1 thesis. Path normalization (forward slashes), `decision_id` pin-through from the
  validated PM output, `human_gate_required` cross-check against the Core-derived effective gate, and
  false-only `safety` booleans are all enforced at the schema/assembler layer — not just in prose.
- **Non-goals (this epic):** `run_id`; `attempt_id`; ticket / manifest / governance edits; status
  write-back; appending to `JOURNAL.md` or `DECISIONS.md`; auto commit / push / PR / merge;
  multi-ticket behavior; hooks; `forge doctor`; `forge init-target`; installer or plugin packaging;
  `finished_at` or any timestamp field (would break byte-determinism); per-attempt CORRECT-loop
  reports (terminal PASS / final ESCALATE only).
- **Constraints:** human-gated; one ticket at a time; the run stops at the commit gate; the engineer
  edits only `allowed_paths`. Core's `src/agents/parse-output.ts`, `src/agents/schemas.ts`, and
  `src/agents/index.ts` stay strict and out of bounds. The T01 orchestrator modules
  (`decision-id`, `decisions-ledger`, `dispatch`, `packets`, `pm-dispatch`) are **read-only inputs**
  the writer consumes — not work in scope for this epic.

## Sprints

- `sprint-01-runtime-evidence-writer` — Core-owned `forge-run-report/v1` schema + pure assembler +
  `forge run-report write` CLI subcommand + orchestrator step 10/11 rewrite + one-paragraph design-doc
  clarification (T01).

> Self-run note: this epic edits ForgeGate's own CLI and the orchestrator procedure, so its tickets
> are driven with a **frozen build** (`pnpm build` then `FORGE_BIN="node <repo>/dist/cli.js"`) so a
> run cannot mutate the tool executing it.
