---
schema_version: 1
id: T01
title: Make the effective gate flow Core-file to Core-file
kind: green
status: pending
risk: medium
change_class: feature
blast_radius: module
depends_on: []
blocks: []
allowed_paths:
  - src/guard/active-ticket.ts
  - src/guard/active-ticket.test.ts
  - src/cli/active-ticket.ts
  - src/cli/active-ticket.test.ts
  - src/run-report/cli.ts
  - src/run-report/cli.test.ts
  - src/run-report/assemble.ts
  - src/run-report/assemble.test.ts
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm typecheck
  - pnpm test
forbidden_paths:
  - src/run-report/schema.ts
  - src/orchestrator/**
  - src/agents/**
  - agents/**
  - src/schema/**
  - src/guard/path-guard.ts
  - src/guard/cli.ts
  - src/guard/git.ts
  - src/validate/**
  - src/install/**
  - src/importer/**
  - src/run/**
  - src/fs/**
  - src/cli/run.ts
  - commands/**
  - docs/**
  - README.md
  - "*.md"
  - package.json
  - pnpm-lock.yaml
  - tsconfig.json
  - vitest.config.ts
  - .github/**
  - .claude/**
  - scripts/**
  - pilot-local/**
  - sandbox-epic/**
  - sandbox-local/**
  - .forge/**
  - "**/.forge/**"
  - "**/*.private.md"
---

# T01 — Make the effective gate flow Core-file to Core-file

## Scope

Make the Core-emitted `active-ticket.json` the single source of truth for the effective gate, and have the
run-report writer read the gate from there instead of trusting the orchestrator-supplied `--gate-*` flags.
This closes the gate-provenance seam under both the current Markdown fallback and the future
workflow-backed runner.

Four mechanical changes:

1. **Active-ticket schema carries the gate.** Add an optional, typed `gate` object to `ActiveTicketSchema`
   in `src/guard/active-ticket.ts`. Shape: `{ declared: string (non-empty), effective: string
   (non-empty), human_required: boolean }`, itself a strict object, optional at the top level so files
   without it still parse. The path-fence guard must continue to ignore the gate entirely
   (`fenceOf` is unchanged).

2. **Active-ticket emitter emits the gate.** In `src/cli/active-ticket.ts`, `buildActiveTicket` must emit
   `gate` from the `ActiveRun.gate` it already receives (it currently drops it).

3. **Run-report writer sources the gate from the active-ticket.** In `src/run-report/cli.ts`, after the
   active-ticket is parsed, build `runtime.effective_gate` from `active-ticket.gate` (the source of
   truth). The `--gate-declared` / `--gate-effective` / `--gate-human-required` flags become **optional
   cross-checks only**: if supplied they must equal the active-ticket gate, else fail with
   `GATE_PROVENANCE_MISMATCH`. If the active-ticket has no gate, fail with `GATE_SOURCE_MISSING`. There is
   **no** flag fallback — pure-strict.

4. **`assemble.ts` is headroom only.** The assembler already compares the PM's `human_gate_required`
   against `runtime.effective_gate` and builds the report gate from it; once `cli.ts` sources
   `runtime.effective_gate` from the active-ticket, the assembler needs no logic change. `assemble.ts`
   and `assemble.test.ts` are in `allowed_paths` only as headroom; prefer not to change their logic.

## Out of Scope

- The workflow runner itself (Phase 2b).
- Decision-id assignment provenance (Phase B2).
- Run-report `agent_output_source` tracking (Phase 1c).
- Any change to `src/run-report/schema.ts` — the run-report already carries a `gate` object; only the
  *source* of that value changes. The frozen schema is forbidden.
- Any change to `src/orchestrator/packets.ts` — `ActiveRun.gate` is already produced correctly; the
  orchestrator package is forbidden.
- Editing `commands/**`. The Markdown runner stays compatible without edits (it emits the active-ticket
  via Core, which will now include the gate, and still passes matching `--gate-*` flags that satisfy the
  cross-check). A command cleanup is a later doc-only follow-up.

## AI Instructions

- TDD: write the failing tests first (RED), then the minimal implementation (GREEN). Do not weaken a test
  to make it pass.
- Two existing tests encode the *old* behavior and must be updated as part of this work (this is expected,
  not scope creep — both files are in `allowed_paths`):
  - `src/guard/active-ticket.test.ts` has a case that passes a string `gate` among "unknown" fields and
    asserts the gate is stripped. With a typed optional `gate`, drop `gate` from that unknown-fields
    fixture (keep `epic` / `sprint` / `phase` / `timestamp` as the genuine strip cases) and add a new
    case asserting a valid gate object round-trips.
  - `src/cli/active-ticket.test.ts` has a case asserting `buildActiveTicket` does not carry the gate;
    flip it to assert the gate is emitted and correct.
- Keep the active-ticket top-level object non-strict (its documented exception), but make the nested
  `gate` object strict so a malformed gate is rejected rather than silently stripped.
- Put the gate cross-check and the new failure codes in `src/run-report/cli.ts` (it is the only site that
  has both the flags and the parsed active-ticket). Add `GATE_PROVENANCE_MISMATCH` and
  `GATE_SOURCE_MISSING` to the writer's failure-code union.
- Do not change `src/run-report/schema.ts` or `src/orchestrator/packets.ts`.
- All file IO must continue to go through the existing injected seams; do not add direct `node:fs` calls
  to the run-report writer.

## Acceptance Criteria

1. `ActiveTicketSchema` accepts a valid `gate` object (`{ declared, effective, human_required }`) and
   round-trips it through `parseActiveTicket`.
2. `ActiveTicketSchema` still accepts an active-ticket without a `gate` field at the schema-parse level
   (the field is optional).
3. `ActiveTicketSchema` rejects a malformed `gate` (wrong type, missing sub-field, or extra sub-key) as
   `ACTIVE_TICKET_INVALID`.
4. `buildActiveTicket` emits `gate` derived from `ActiveRun.gate`.
5. `forge guard paths` ignores the `gate` field and preserves all existing fence behavior (no guard
   finding is produced or suppressed because of the gate).
6. `forge run-report write` sources `runtime.effective_gate` from `active-ticket.gate`.
7. The `--gate-declared` / `--gate-effective` / `--gate-human-required` flags are optional (the writer no
   longer requires them).
8. Supplied `--gate-*` values that match `active-ticket.gate` succeed.
9. Supplied `--gate-*` values that disagree with `active-ticket.gate` return `GATE_PROVENANCE_MISMATCH`.
10. An active-ticket with no `gate` during `run-report write` returns `GATE_SOURCE_MISSING`.
11. `HUMAN_GATE_MISMATCH` still fires when the PM output's `human_gate_required` disagrees with the
    Core-sourced `gate.human_required`.
12. `HUMAN_GATE_MISMATCH` cannot be made tautological by passing the PM's value as `--gate-human-required`
    (the gate source is the active-ticket, not the flag).
13. The existing Markdown `/forge-run-ticket` path stays compatible without editing `commands/**`.
14. No change to `src/run-report/schema.ts`.
15. No change to `src/orchestrator/packets.ts`.
16. `pnpm test` and `pnpm typecheck` pass.
