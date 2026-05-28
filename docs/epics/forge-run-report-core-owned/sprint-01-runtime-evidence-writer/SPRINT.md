# Sprint 01 — Core-owned runtime evidence writer

One ticket: introduce a Core module that owns the `forge-run-report/v1` schema (Zod, `.strict()`,
closed shape), a pure assembler that takes Core-validated inputs and emits a typed `RunReport`, and a
`forge run-report write` CLI subcommand that defaults file inputs and the `--out` path to
`<epic>/.forge/<canonical-name>`. The orchestrator procedure (`commands/forge-run-ticket.md` steps
10–11) is rewritten to invoke that command instead of hand-authoring the JSON. A short paragraph in
`docs/forge-run-ticket-design.md` clarifies that the run-report is now Core-owned **runtime evidence
only** — not status write-back, not journal automation, not run identity, not commit/push/PR/merge
automation.

**Done means:** T01's Acceptance Criteria are met, both verifiers APPROVE, `pnpm test` + `pnpm
typecheck` are green, and the run stops at the commit gate for a human.

**Halt-triggers:** any change outside T01's `allowed_paths`; any change that loosens
`src/agents/parse-output.ts` / `src/agents/schemas.ts` / `src/agents/index.ts`; any change to the T01
orchestrator modules (`decision-id`, `decisions-ledger`, `dispatch`, `packets`, `pm-dispatch`) which
are read-only inputs for this work; any `safety.*` boolean typed as anything other than
`z.literal(false)`; any code path that writes `JOURNAL.md`, `DECISIONS.md`, a ticket file, a
manifest, or anything outside `<epic>/.forge/run-report.json`; the inclusion of `run_id`,
`attempt_id`, `finished_at`, or any other field outside the approved closed schema; a failing verify
command after the correction cap.
