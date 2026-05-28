# ForgeGate — deterministic monotonic PM decision IDs

Give every PM decision a Core-assigned, monotonic per-epic identifier so run-reports and the audit trail
can refer to each judgment unambiguously, while keeping Core's parser and schemas strict and the agent
honest.

- **Goal:** Core owns the decision identifier. The PM packet pins an assigned `decision_id`; the PM
  echoes it verbatim; `parse-agent pm` cross-checks the echo against an expected value. A small per-epic
  ledger at `$EPIC/.forge/decisions-ledger.json` records accepted decisions so the next run picks a fresh
  number.
- **Non-goals (this epic):** a Core-owned run-report writer; a canonical `run_id` / `attempt_id`; status
  write-back; journal automation (no writes to `JOURNAL.md` or `DECISIONS.md`); hooks; doctor;
  init-target; installer or plugin packaging; auto commit / push / PR / merge; multi-ticket behavior.
- **Constraints:** human-gated; one ticket at a time; the run stops at the commit gate; the engineer
  edits only the ticket's `allowed_paths`. Core's `src/agents/parse-output.ts`,
  `src/agents/schemas.ts`, and `src/agents/index.ts` stay strict and are out of bounds for this
  work — the cross-check lives in the CLI command layer, not in the validator.

## Sprints

- `sprint-01-monotonic-pm-decision-id` — Core-assigned decision id + small per-epic ledger + PM
  pin-and-echo + parser cross-check (T01).

> Self-run note: this epic edits ForgeGate's own CLI and orchestrator path, so its tickets are driven
> with a **frozen build** (`pnpm build` then `FORGE_BIN="node <repo>/dist/cli.js"`) so a run cannot
> mutate the tool executing it.
