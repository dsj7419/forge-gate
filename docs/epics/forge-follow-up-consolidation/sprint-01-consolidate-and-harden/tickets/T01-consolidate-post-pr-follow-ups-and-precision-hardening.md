---
schema_version: 1
id: T01
title: Consolidate post-PR follow-ups and precision hardening
kind: green
risk: low
change_class: refactor
blast_radius: local
status: pending
gate: pr
gate_override: false
allowed_paths:
  - "src/run-report/cli.ts"
  - "src/run-report/cli.test.ts"
  - "src/run-report/assemble.ts"
  - "src/run-report/assemble.test.ts"
  - "src/orchestrator/packets.ts"
  - "src/orchestrator/packets.test.ts"
  - "src/orchestrator/pm-dispatch.test.ts"
  - "src/orchestrator/dispatch.ts"
  - "src/orchestrator/dispatch.test.ts"
  - "src/cli/run.test.ts"
  - "commands/forge-run-ticket.md"
  - "README.md"
forbidden_paths:
  - "src/agents/**"
  - "src/schema/**"
  - "src/validate/**"
  - "src/guard/**"
  - "src/install/**"
  - "src/importer/**"
  - "src/orchestrator/decision-id.ts"
  - "src/orchestrator/decision-id.test.ts"
  - "src/orchestrator/decisions-ledger.ts"
  - "src/orchestrator/decisions-ledger.test.ts"
  - "src/run-report/schema.ts"
  - "src/run-report/schema.test.ts"
  - "src/cli/run.ts"
  - "agents/**"
  - "package.json"
  - "pnpm-lock.yaml"
  - "tsconfig.json"
  - "vitest.config.ts"
  - "docs/epics/**"
  - "docs/forge-run-ticket-design.md"
verify_commands:
  - "pnpm test"
  - "pnpm typecheck"
---
## Scope

Retire the four FOLLOW_UP_OK items recorded by the focused reviews of PRs #5 and #6 in a single
tightening pass. No new capabilities; no behavior change visible to users; the
`forge-run-report/v1` schema and Core's agent parsers stay untouched.

Four scoped sub-fixes, all small:

1. **Drop the dead `SAFETY_INVARIANT_VIOLATION` member** from the `FailureCode` union at
   `src/run-report/cli.ts:84-93`. No execution path emits it. Safety violations surface via
   `RUN_REPORT_INVALID` because the schema's `z.literal(false)` for each `safety.*` boolean
   rejects them at parse time — that is the stronger enforcement layer. No new runtime check is
   added; the schema's existing rejection stays in force.

2. **Make `parse_validation.pm` truthful.** Extend the internal
   `OrchestratorConfirmedFactsSchema` (`src/orchestrator/packets.ts:82-95`) with a required
   `pm: boolean` field. Update the run-report assembler (`src/run-report/assemble.ts:159-167`) to
   read `facts.parse_validation.pm` instead of hard-coding `pm: true`. Update step 9(c) guidance
   in `commands/forge-run-ticket.md` so the orchestrator writes `pm: true` to
   `orchestrator-facts.json` only after `parse-agent pm` returns `ok:true` AND the
   `--expected-decision-id` cross-check succeeds. The `forge-run-report/v1` schema itself is
   unchanged — only the upstream facts artifact gains the field.

3. **Harden the PM render-context** at `src/orchestrator/dispatch.ts:105-107`. The current
   `if (i.assigned_decision_id !== null) { lines.push(...renderAssignedDecisionId(...)); }`
   silently omits the authoritative section when the slot is null. Both current callers fill it
   (`buildPmDispatch` requires it; the skeleton path in `src/cli/run.ts:175-186` fills it from
   the validated CLI flag), so the null branch is unreachable today — but the PM charter teaches
   the agent to read that section, so a future caller that forgets to fill it would silently
   leave the PM without its pinned id. Defense in depth: throw at render time when a PM packet
   reaches `renderContext` with `assigned_decision_id === null`. Use the smallest safe
   implementation.

4. **Correct the v1 write-enumeration parenthetical.** `commands/forge-run-ticket.md:32-33`
   lists the gitignored `.forge/` runtime as
   `(active-ticket.json, lock.json, run-report.json)` — the post-T01 fourth entry
   `decisions-ledger.json` is missing. The parallel statement in `README.md` "v1 safety model"
   section has the same omission. Add `decisions-ledger.json` to both. The general clause
   ("gitignored `.forge/` runtime") already covers it; this is precision polish, not a behavior
   change.

## Out of Scope

- Any change to `src/agents/parse-output.ts`, `src/agents/schemas.ts`, or `src/agents/index.ts` —
  Core's agent parsers and schemas stay strict.
- Any change to `src/run-report/schema.ts` or `src/run-report/schema.test.ts` — the
  `forge-run-report/v1` artifact stays stable.
- Any change to the T01 decision-id modules: `src/orchestrator/decision-id.ts`,
  `decisions-ledger.ts`, or their tests.
- Any change to `src/cli/run.ts` — the CLI router wiring for `forge dispatch pm` /
  `forge parse-agent pm` / `forge run-report write` stays as it is. `src/cli/run.test.ts` and
  `src/run-report/cli.test.ts` may be touched **only** to add `pm: true` to existing FACTS /
  `OrchestratorConfirmedFacts` test fixtures — the necessary blast radius of sub-fix #2's schema
  extension. No new tests in those files; no router-wiring or USAGE assertion changes.
- `run_id` or `attempt_id` — separate concern; not in this ticket.
- Status write-back, ticket file edits, manifest edits, governance edits.
- Any code path that writes `JOURNAL.md` or `DECISIONS.md`.
- Auto commit / push / PR / merge / multi-ticket behavior.
- Hooks, `forge doctor`, `forge init-target`, installer or plugin packaging.
- Any change to the four agent charters under `agents/`.

## AI Instructions

- TDD per the house style: write RED tests first for sub-fixes 2 and 3 before any implementation
  code.
- For sub-fix 1 (the unused union member): a one-line edit to `src/run-report/cli.ts:84-93`.
  Confirm via `grep` that no other reference to the symbol exists in `src/` after editing.
- For sub-fix 2 (`pm: boolean` in facts):
  - Add `pm: z.boolean()` to the `parse_validation` object in `packets.ts:82-95`. The object
    stays `.strict()`. The exported `OrchestratorConfirmedFacts` type updates by Zod inference.
  - Update `packets.test.ts` with a test that asserts
    `OrchestratorConfirmedFactsSchema.safeParse(...)` rejects a facts object whose
    `parse_validation` is missing the `pm` field.
  - Update the existing `FACTS` fixture in `pm-dispatch.test.ts:48-54` to include `pm: true`
    so that suite stays green under the stricter schema.
  - In `assemble.ts:159-167`, replace the hard-coded `pm: true` with
    `pm: facts.parse_validation.pm` and drop the now-stale comment block explaining the
    hard-code.
  - Extend the assembler's `RESULT_REQUIRES_GREEN` check at `assemble.ts:118-139` so PASS is
    refused when `facts.parse_validation.pm === false` (parallel to the existing
    engineer/semantic_verifier/scope_verifier checks).
  - In `assemble.test.ts`, add: (a) a happy-path assertion that `parse_validation.pm` is
    propagated from facts to the assembled report; (b) a negative test where
    `facts.parse_validation.pm === false` and `result: "PASS"` is requested → exit failure code
    `RESULT_REQUIRES_GREEN`.
  - Update `commands/forge-run-ticket.md` step 9(c) so the facts JSON example includes `pm` in
    `parse_validation`, and the surrounding prose says `pm: true` is recorded only after
    `parse-agent pm` returns `ok:true` AND the `--expected-decision-id` cross-check succeeds
    (i.e. step 9(e)'s call exits 0).
- For sub-fix 3 (throw on null at render): in `dispatch.ts` `renderContext` pm branch, change
  the silent-omit `if (i.assigned_decision_id !== null) { ... }` into an immediate `throw new
  Error(...)` when the slot is null. The thrown error message must name the role (`pm`) and the
  precondition (`assigned_decision_id must be pinned before the pm packet renders`). Add a
  negative test in `dispatch.test.ts` constructing a PM packet (from `generateRunPackets`, where
  the skeleton leaves `assigned_decision_id: null`) and asserting `buildAgentDispatch('pm',
  packets, options)` throws. The existing happy-path tests continue to pass because they fill
  the slot via `buildPmDispatch` or the CLI skeleton path.
- For sub-fix 4 (write-enumeration): change `commands/forge-run-ticket.md:32-33` so the
  parenthetical reads `(active-ticket.json, lock.json, run-report.json, decisions-ledger.json)`.
  Update the parallel enumeration in `README.md` "v1 safety model" section to match. The general
  clause ("gitignored `.forge/` runtime artifacts") is unchanged.

## Acceptance Criteria

- [ ] `src/run-report/cli.ts` — the `FailureCode` union no longer carries
      `SAFETY_INVARIANT_VIOLATION`. `grep -nE 'SAFETY_INVARIANT_VIOLATION' src/` returns no
      matches. Schema-level rejection of `safety.*: true` continues to surface as
      `RUN_REPORT_INVALID`.
- [ ] `src/orchestrator/packets.ts` —
      `OrchestratorConfirmedFactsSchema.parse_validation` gains a required `pm: z.boolean()`
      field. The object stays `.strict()`.
- [ ] `src/orchestrator/packets.test.ts` — adds an assertion that
      `OrchestratorConfirmedFactsSchema.safeParse(...)` rejects a facts object whose
      `parse_validation` is missing `pm`.
- [ ] `src/orchestrator/pm-dispatch.test.ts` — its `FACTS` fixture is updated to include
      `pm: true` so the existing tests continue to pass under the stricter schema.
- [ ] `src/run-report/assemble.ts` — the report's `parse_validation.pm` is sourced from
      `facts.parse_validation.pm` rather than hard-coded. `RESULT_REQUIRES_GREEN` is extended
      so PASS is refused when `facts.parse_validation.pm === false`.
- [ ] `src/run-report/assemble.test.ts` — adds: a happy-path assertion that
      `parse_validation.pm` is propagated from facts to the assembled report; a negative test
      where `facts.parse_validation.pm === false` and `result: "PASS"` is requested →
      `RESULT_REQUIRES_GREEN`.
- [ ] `src/orchestrator/dispatch.ts` — `renderContext` for the `pm` role throws (clear
      `Error`-with-message naming the role and the precondition) when the packet's
      `assigned_decision_id` is `null` instead of silently omitting the authoritative section.
      Smallest safe implementation; no broader PM packet shape change.
- [ ] `src/orchestrator/dispatch.test.ts` — adds a negative test that builds a PM packet from
      `generateRunPackets` (so `assigned_decision_id` is `null` in the skeleton) and asserts that
      `buildAgentDispatch('pm', packets, options)` throws. Existing happy-path tests still pass.
- [ ] `commands/forge-run-ticket.md`:
      (a) the parenthetical at lines 32-33 reads
      `(active-ticket.json, lock.json, run-report.json, decisions-ledger.json)`;
      (b) step 9(c) facts JSON example includes `pm` in `parse_validation` and the surrounding
      prose says `pm: true` is recorded only after `parse-agent pm` returns `ok:true` AND the
      `--expected-decision-id` cross-check succeeds.
- [ ] `README.md` "v1 safety model" section's parenthetical listing the gitignored `.forge/`
      runtime artifacts is updated to include `decisions-ledger.json`.
- [ ] `src/agents/parse-output.ts`, `src/agents/schemas.ts`, `src/agents/index.ts`,
      `src/run-report/schema.ts`, `src/run-report/schema.test.ts`, `src/orchestrator/decision-id.ts`,
      `decision-id.test.ts`, `decisions-ledger.ts`, `decisions-ledger.test.ts`, `src/cli/run.ts`,
      and all files under `agents/` are unchanged (git diff empty for each).
- [ ] `src/cli/run.test.ts` and `src/run-report/cli.test.ts` changes are limited to adding
      `pm: true` to existing FACTS / `OrchestratorConfirmedFacts` fixtures — no new tests, no
      router-wiring or USAGE assertion changes.
- [ ] `pnpm test` and `pnpm typecheck` pass.
