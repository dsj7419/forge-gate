---
schema_version: 1
id: T01
title: Promote forge-run-report/v1 to a Core-owned, validated artifact
kind: green
risk: low
change_class: feature
blast_radius: local
status: pending
gate: pr
gate_override: false
allowed_paths:
  - "src/run-report/schema.ts"
  - "src/run-report/schema.test.ts"
  - "src/run-report/assemble.ts"
  - "src/run-report/assemble.test.ts"
  - "src/run-report/cli.ts"
  - "src/run-report/cli.test.ts"
  - "src/cli/run.ts"
  - "src/cli/run.test.ts"
  - "commands/forge-run-ticket.md"
  - "docs/forge-run-ticket-design.md"
forbidden_paths:
  - "src/agents/**"
  - "src/schema/**"
  - "src/validate/**"
  - "src/guard/**"
  - "src/install/**"
  - "src/importer/**"
  - "src/orchestrator/decision-id.ts"
  - "src/orchestrator/decisions-ledger.ts"
  - "src/orchestrator/dispatch.ts"
  - "src/orchestrator/packets.ts"
  - "src/orchestrator/pm-dispatch.test.ts"
  - "src/orchestrator/decision-id.test.ts"
  - "src/orchestrator/decisions-ledger.test.ts"
  - "src/orchestrator/packets.test.ts"
  - "src/orchestrator/dispatch.test.ts"
  - "agents/**"
  - "package.json"
  - "pnpm-lock.yaml"
  - "tsconfig.json"
  - "vitest.config.ts"
  - "docs/epics/**"
  - "README.md"
verify_commands:
  - "pnpm test"
  - "pnpm typecheck"
---
## Scope

Make `$EPIC/.forge/run-report.json` a Core-owned, typed, validated runtime evidence artifact. Today
the report is hand-authored by the orchestrator command at step 10 of
`commands/forge-run-ticket.md`; six existing reports already show significant field drift (different
keys for the same concept across runs, inconsistent path normalization with backslashes vs forward
slashes, and a growing set of episode-specific one-off fields), and there is no Core schema, no
validator, and no writer. This ticket adds the smallest design that closes that gap without
expanding behavior:

1. New Core module `src/run-report/` defines a strict Zod schema for `forge-run-report/v1` (closed
   shape, unknown top-level fields rejected), plus a pure assembler that consumes the Core-validated
   inputs the orchestrator already gathers (active-ticket, four agent outputs, orchestrator-facts)
   and emits a typed `RunReport` or a typed failure.
2. `forge run-report write <epic-path>` CLI subcommand wires the assembler to disk through an
   injected IO seam (mirrors `src/install/` and `src/orchestrator/decisions-ledger.ts`). It defaults
   the file inputs and the `--out` path to `<epic>/.forge/<canonical-name>`.
3. The orchestrator command (`commands/forge-run-ticket.md` steps 10 and 11) is rewritten to invoke
   `forge run-report write` instead of hand-authoring the JSON. The orchestrator no longer builds the
   report; it only supplies the runtime metadata it alone knows (`--result`, `--checkpoint-base`,
   `--checkpoint-head`, `--guard-result`, `--guard-exit`, optional commit-gate materials, optional
   `--note` entries).
4. `docs/forge-run-ticket-design.md` gains one short paragraph clarifying that the run-report is now
   Core-owned **runtime evidence only** — explicitly not status write-back, not journal automation,
   not run identity, not commit/push/PR/merge automation.

The v1 safety thesis is baked into the schema, not just the docs: every `safety.*` boolean is typed
as `z.literal(false)`. If any future caller tries to write `safety.committed: true` (or any of the
other five), the schema rejects it. A future version that unlocks one of those is a deliberate
schema bump (`forge-run-report/v2`), not a silent change.

## Out of Scope

- Any change to `src/agents/parse-output.ts`, `src/agents/schemas.ts`, or `src/agents/index.ts` —
  Core's validator and schemas stay strict.
- Any change to the T01 orchestrator modules: `src/orchestrator/decision-id.ts`,
  `decisions-ledger.ts`, `dispatch.ts`, `packets.ts`, `pm-dispatch.test.ts`,
  `decision-id.test.ts`, `decisions-ledger.test.ts`, `packets.test.ts`, `dispatch.test.ts`.
  These are read-only **inputs** the writer consumes; they are not work in scope.
- `run_id` or `attempt_id` — separate concern, separate future ticket; not in this schema.
- Status write-back, ticket file edits, manifest edits, governance edits.
- Any code path that writes `JOURNAL.md` or `DECISIONS.md`.
- Auto commit / push / PR / merge / multi-ticket behavior.
- Hooks, `forge doctor`, `forge init-target`, installer or plugin packaging.
- `finished_at` or any other timestamp field — keep T01 output byte-deterministic.
- Per-attempt run-reports during CORRECT loops. Only `result: "PASS"` and final
  `result: "ESCALATE"` produce a report.
- Any change to `README.md`. The Commands table can be updated in a follow-on if needed.
- Any change to the four agent charters under `agents/`.

## AI Instructions

- TDD per the house style: write RED tests first for the schema and the assembler before any
  implementation code.
- Mirror `src/install/` and `src/orchestrator/decisions-ledger.ts` for the IO seam pattern. The
  writer exposes a single `RunReportIo` with at minimum `writeFile(file, contents)` (and
  `readFileIfExists(file)` if needed for default input lookup). No real disk I/O in unit tests —
  every file in/out goes through the seam.
- Schema layering: `src/run-report/schema.ts` exports `RunReportSchema` (Zod, `.strict()`) and the
  inferred `RunReport` type. The `schema` field is `z.literal("forge-run-report/v1")`; the `command`
  field is `z.literal("/forge-run-ticket")`; `result` is `z.enum(["PASS", "ESCALATE"])`; every
  `safety.*` boolean is `z.literal(false)` (no `z.boolean()` union — false-only, by type).
- The assembler in `src/run-report/assemble.ts` is a pure function that takes the already-parsed
  inputs (engineer / semantic / scope / pm outputs via `parseAgentOutput`, orchestrator-confirmed
  facts via `OrchestratorConfirmedFactsSchema`, the active-ticket file) plus orchestrator-supplied
  runtime metadata (checkpoint SHAs, guard result, guard exit, optional commit-gate materials,
  optional notes) and returns a typed `RunReport` or `{ok:false; code; errors}`. Path normalization
  (Windows backslashes → forward slashes) happens here. Inputs are not mutated.
- `decision_id` is read from the validated PM output and preserved verbatim. The schema enforces
  shape (`^D-\d+$`). Cross-checks against the assigned id from the decisions-ledger were already done
  at step 9 by `parse-agent pm --expected-decision-id`; the assembler relies on that prior
  validation and does not re-implement it.
- `human_gate_required` is cross-checked against the Core-derived effective gate (mirrors the pin
  pattern already in `src/orchestrator/dispatch.ts`'s effective-gate section). Disagreement returns
  `HUMAN_GATE_MISMATCH`.
- `result: "PASS"` is only allowed when all four `parse_validation` fields are true AND both
  verifiers are `APPROVE` AND PM `decision` is `PASS`. Otherwise the assembler returns
  `RESULT_REQUIRES_GREEN`. `result: "ESCALATE"` accepts any combination (it is a terminal evidence
  report for a non-green run).
- The CLI command `forge run-report write <epic-path>` (in `src/run-report/cli.ts`, wired from
  `src/cli/run.ts`) defaults the agent-output, facts, and active-ticket file inputs to
  `<epic>/.forge/<canonical-name>` (`engineer-output.yaml`, `semantic-verifier-output.yaml`,
  `scope-verifier-output.yaml`, `pm-output.yaml`, `orchestrator-facts.json`, `active-ticket.json`)
  and defaults `--out` to `<epic>/.forge/run-report.json`. Explicit flags override. The writer
  never produces a path outside `<epic>/.forge/`.
- Deterministic JSON output: 2-space indent, trailing newline, top-level key order pinned to the
  schema declaration order (not alphabetical — keep the human-readable order). Two runs against
  identical inputs MUST produce byte-identical files. Test this.
- Rewrite `commands/forge-run-ticket.md` steps 10 and 11: step 10 invokes
  `node "$FORGE_REPO/dist/cli.js" run-report write "$EPIC" --repo-root "$TARGET_REPO" --result PASS
  --checkpoint-base "$BASE_SHA" --checkpoint-head "$HEAD_SHA" --guard-result "$GUARD_RESULT"
  --guard-exit "$GUARD_EXIT"` plus the optional commit-gate-materials and `--note` flags; step 11
  invokes the same with `--result ESCALATE` plus relevant flags for the failure case. The
  orchestrator no longer hand-builds the JSON. The hard-constraints enumeration at lines 32-33
  keeps its existing language; `decisions-ledger.json` is **not** added here (that is the carried
  `forge-run-ticket-write-enumeration-precision` follow-up, separate ticket).
- Update `docs/forge-run-ticket-design.md` with one short paragraph clarifying that the run-report
  is now Core-owned **runtime evidence only** — explicitly not status write-back, not journal
  automation, not run identity, not commit/push/PR/merge automation. No other content changes.
- One-offs from prior runs (`transport_note`, `in_run_fix_proof`, `recovery`, `follow_up`,
  `bootstrap_note`, `verifier_findings`, `dispatch_mode`) become entries in the optional
  `notes: string[]` field — they do **not** become new top-level fields.

## Acceptance Criteria

- [ ] `src/run-report/schema.ts` exports a Zod `RunReportSchema` (`.strict()`) for
      `forge-run-report/v1` and the inferred `RunReport` type. The `schema` field is
      `z.literal("forge-run-report/v1")`; `command` is `z.literal("/forge-run-ticket")`; `result` is
      `z.enum(["PASS", "ESCALATE"])`; every `safety.*` boolean
      (`committed`, `pushed`, `pr_opened`, `merged`, `status_write_back`, `journal_written`) is
      `z.literal(false)`. Unknown top-level fields are rejected. `decision_id` matches `^D-\d+$`.
- [ ] `src/run-report/schema.test.ts` covers: accepts a fully-populated valid report; rejects each
      missing required field (parameterized); rejects an unknown top-level field; rejects each safety
      boolean set to `true` (parameterized over all six); rejects a non-v1 `schema` literal; rejects
      a `command` other than `/forge-run-ticket`; rejects a malformed `decision_id`.
- [ ] `src/run-report/assemble.ts` exports a pure
      `assembleRunReport(inputs): {ok:true; report} | {ok:false; code; errors}` that takes the
      validated agent outputs, orchestrator-confirmed facts, active-ticket, and
      orchestrator-supplied runtime metadata. It normalizes paths to forward slashes; preserves the
      PM's `decision_id` verbatim; cross-checks `human_gate_required` against the Core-derived
      effective gate (mismatch → `HUMAN_GATE_MISMATCH`); refuses `result: "PASS"` unless all
      `parse_validation` fields are true, both verifiers are `APPROVE`, and PM `decision` is `PASS`
      (else → `RESULT_REQUIRES_GREEN`); allows `result: "ESCALATE"` regardless. Pure (does not
      mutate inputs).
- [ ] `src/run-report/assemble.test.ts` covers: happy path; backslash → forward slash normalization;
      `decision_id` preserved verbatim from PM output; `HUMAN_GATE_MISMATCH` when PM emission and
      effective gate disagree; `RESULT_REQUIRES_GREEN` when `PASS` is requested but a verifier is
      `REJECT`; `RESULT_REQUIRES_GREEN` when `PASS` is requested but any `parse_validation` is
      false; `result: "ESCALATE"` accepted with non-green inputs; one-off narrative lands in `notes`
      (not as new top-level fields); inputs are not mutated.
- [ ] `src/run-report/cli.ts` exports a handler wired from `src/cli/run.ts` as
      `forge run-report write <epic-path>`. Defaults the file inputs (engineer-output,
      semantic-verifier-output, scope-verifier-output, pm-output, orchestrator-facts, active-ticket)
      to `<epic>/.forge/<canonical-name>`. Defaults `--out` to `<epic>/.forge/run-report.json`.
      Returns exit 1 with a typed code (`MISSING_INPUT`, `AGENT_OUTPUT_INVALID`, `FACTS_INVALID`,
      `ACTIVE_TICKET_INVALID`, `HUMAN_GATE_MISMATCH`, `SAFETY_INVARIANT_VIOLATION`,
      `RESULT_REQUIRES_GREEN`, `RUN_REPORT_INVALID`) on any failure. Exit 2 on usage error.
- [ ] `src/run-report/cli.test.ts` covers: default-path happy path writes
      `<epic>/.forge/run-report.json`; explicit `--out` writes elsewhere; missing required flag
      surfaces a usage error (exit 2); invalid agent output → `AGENT_OUTPUT_INVALID` exit 1;
      invalid facts → `FACTS_INVALID` exit 1; **two runs over the same inputs produce byte-identical
      output** (determinism); a spy on the injected IO confirms no write outside
      `<epic>/.forge/run-report.json` — specifically, no `JOURNAL.md`, no `DECISIONS.md`, no ticket
      file, no manifest, no governance file is touched.
- [ ] `src/cli/run.ts` USAGE shows the new `run-report write` subcommand. A test in
      `src/cli/run.test.ts` confirms a happy-path
      `runCli(["run-report", "write", <epic>, ...args], io)` invocation.
- [ ] `commands/forge-run-ticket.md` steps 10 and 11 are rewritten: step 10 invokes
      `node "$FORGE_REPO/dist/cli.js" run-report write "$EPIC" --repo-root "$TARGET_REPO" --result
      PASS --checkpoint-base "$BASE_SHA" --checkpoint-head "$HEAD_SHA" --guard-result
      "$GUARD_RESULT" --guard-exit "$GUARD_EXIT" [--proposed-status-transition …]
      [--suggested-commit-message …] [--suggested-command …] [--note …]`; step 11 invokes the same
      with `--result ESCALATE` plus relevant flags for the failure case. The orchestrator no longer
      hand-builds the JSON.
- [ ] `docs/forge-run-ticket-design.md` gains one short paragraph clarifying that the run-report is
      now Core-owned **runtime evidence only** — explicitly not status write-back, not journal
      automation, not run identity, not commit/push/PR/merge automation. No other content changes.
- [ ] `src/agents/schemas.ts`, `src/agents/parse-output.ts`, and `src/agents/index.ts` are
      unchanged (git diff empty for those three files).
- [ ] `src/orchestrator/decision-id.ts`, `decisions-ledger.ts`, `dispatch.ts`, `packets.ts`,
      `pm-dispatch.test.ts`, `decision-id.test.ts`, `decisions-ledger.test.ts`, `packets.test.ts`,
      `dispatch.test.ts` are unchanged (git diff empty for all nine files).
- [ ] `pnpm test` and `pnpm typecheck` pass.
