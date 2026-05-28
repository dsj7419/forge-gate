# ForgeGate — post-PR follow-up consolidation and precision hardening

Retire the four FOLLOW_UP_OK items recorded by the focused reviews of PRs #5 and #6 in a single
tightening pass — drop dead code, make `parse_validation.pm` truthful from the
orchestrator-confirmed facts, harden the PM dispatch render-context against a null assigned id, and
bring the v1 write-enumeration parenthetical in sync with what Core actually writes.

- **Goal:** reduce accumulated review debt without expanding ForgeGate's autonomy. Tighten existing
  surfaces; do not add capabilities. Forge Core's `forge-run-report/v1` schema, agent parsers,
  decision-id allocator, and decisions ledger stay unchanged. The only schema motion is one new
  `pm: boolean` field on the internal `OrchestratorConfirmedFactsSchema` so the report can record
  PM parse validation truthfully instead of hard-coding it.
- **Non-goals (this epic):** any change to `forge-run-report/v1` schema; any change to agent
  parser schemas or `src/agents/**`; hooks; `forge doctor`; `forge init-target`; installer or
  plugin packaging; status write-back; journal automation; `run_id`; `attempt_id`; auto commit /
  push / PR / merge; multi-ticket behavior.
- **Constraints:** human-gated; one ticket at a time; the run stops at the commit gate; the
  engineer edits only the ticket's `allowed_paths`. Core's strictness contract is unchanged —
  only internal precision moves.

## Sprints

- `sprint-01-consolidate-and-harden` — drop the dead `SAFETY_INVARIANT_VIOLATION` union member;
  extend `OrchestratorConfirmedFactsSchema` with `pm: boolean` and wire it through the assembler
  + the orchestrator command's step 9(c); harden `renderContext` so the PM render fails when a
  packet reaches it without a pinned `assigned_decision_id`; correct the v1 write-enumeration
  parenthetical in both `commands/forge-run-ticket.md` and `README.md` (T01).

> Self-run note: this epic edits ForgeGate's own Core orchestrator path, so its tickets are driven
> with a **frozen build** (`pnpm build` then `FORGE_BIN="node <repo>/dist/cli.js"`) so a run cannot
> mutate the tool executing it.
