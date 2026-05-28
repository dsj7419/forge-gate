---
schema_version: 1
id: T01
title: Assign deterministic monotonic PM decision IDs
kind: green
risk: low
change_class: feature
blast_radius: local
status: pending
gate: pr
gate_override: false
allowed_paths:
  - "src/orchestrator/decision-id.ts"
  - "src/orchestrator/decision-id.test.ts"
  - "src/orchestrator/decisions-ledger.ts"
  - "src/orchestrator/decisions-ledger.test.ts"
  - "src/orchestrator/packets.ts"
  - "src/orchestrator/packets.test.ts"
  - "src/orchestrator/dispatch.ts"
  - "src/orchestrator/dispatch.test.ts"
  - "src/orchestrator/pm-dispatch.test.ts"
  - "src/cli/run.ts"
  - "src/cli/run.test.ts"
  - "agents/forge-pm.md"
  - "src/agents/charter-output-format.test.ts"
  - "commands/forge-run-ticket.md"
forbidden_paths:
  - "src/agents/schemas.ts"
  - "src/agents/parse-output.ts"
  - "src/agents/index.ts"
  - "src/schema/**"
  - "src/validate/**"
  - "src/guard/**"
  - "src/install/**"
  - "src/importer/**"
  - "agents/forge-engineer.md"
  - "agents/forge-semantic-verifier.md"
  - "agents/forge-scope-verifier.md"
  - "package.json"
  - "pnpm-lock.yaml"
  - "tsconfig.json"
  - "vitest.config.ts"
  - "docs/epics/**"
verify_commands:
  - "pnpm test"
  - "pnpm typecheck"
---
## Scope

Give Core ownership of the PM `decision_id`. Today the PM agent picks the value with no context — the
charter shows the literal example `D-001`, the dispatch packet carries no prior-decision information,
and `src/agents/schemas.ts` validates shape only — so every PM dispatch emits the same id, observed
across multiple runs and now visible in `.forge/run-report.json`. The fix is the smallest C-strict
design that closes the ambiguity without weakening Core's strict parser or schemas:

1. Core computes the next monotonic id from a small per-epic ledger at
   `$EPIC/.forge/decisions-ledger.json` (gitignored, runtime-only, alongside `lock.json` and
   `active-ticket.json`).
2. `forge dispatch pm` accepts `--assigned-decision-id <D-NNN>` and pins it as authoritative in the PM
   packet.
3. The PM charter is updated so the agent echoes the pinned value verbatim, never inventing one.
4. `forge parse-agent pm` accepts `--expected-decision-id <D-NNN>` and, after normal schema validation,
   fails with `DECISION_ID_MISMATCH` if the emitted id does not equal the expected value. The Zod
   schema for `PMOutput` is **not** changed; the cross-check is a post-validation step in the CLI
   command (`src/cli/run.ts`).
5. The orchestrator wrapper (`commands/forge-run-ticket.md`) reads the ledger, computes the next id via
   Core, wires both flags, and appends the accepted decision to the ledger after the PM output
   validates.

The ledger module is intentionally small (a reader and an appender behind an injected IO seam) and is
**not** a general-purpose run-report writer; it must not grow into one.

## Out of Scope

- Any change to `src/agents/parse-output.ts`, `src/agents/schemas.ts`, or `src/agents/index.ts` —
  Core's validator and schemas stay strict; the cross-check is a CLI-layer step, not a schema rule.
- A Core-owned `run-report.json` writer, a canonical `run_id`, or an `attempt_id` — separate follow-on
  tickets.
- Status write-back, journal automation, or any write to `JOURNAL.md` or `DECISIONS.md`.
- Hooks, `forge doctor`, `forge init-target`, installer or plugin packaging, auto commit / push / PR /
  merge, multi-ticket behavior.
- Any change to the engineer / semantic-verifier / scope-verifier charters; only the PM charter
  changes.

## AI Instructions

- TDD per the house style. RED tests first for `nextDecisionId` and the ledger before any
  implementation code is written.
- Mirror `src/install/`'s injected-IO pattern (`InstallReader`) for the ledger seam — no real disk I/O
  in unit tests. Keep the ledger surface small: one reader, one appender, both fed by an injected IO
  object. No general-purpose writer.
- The PM packet field is additive: `PMPacket.inputs.assigned_decision_id: string | null` (null in the
  skeleton from `generateRunPackets`, filled at dispatch time by `buildPmDispatch`). `buildPmDispatch`
  fails closed with a typed error if absent.
- Render the pinned id in the PM prompt under an "## Assigned decision_id (authoritative — use
  verbatim, never invent)" section, modeled on the existing "## Effective gate (authoritative …)"
  section already in `src/orchestrator/dispatch.ts`. Same pattern, same authority.
- The PM charter rule sits next to the existing `human_gate_required` rule — both are Core-pinned
  authoritative values the PM echoes; mention them together for clarity.
- `parse-agent pm --expected-decision-id` returns exit 1 on mismatch with the failure code
  `DECISION_ID_MISMATCH`; without the flag, behavior is unchanged (back-compatible — schema-only
  validation).
- `commands/forge-run-ticket.md` step 9 procedure becomes: (a) read the ledger via Core, (b) compute
  the next id via Core, (c) pass `--assigned-decision-id` to `forge dispatch pm`, (d) capture the PM
  output, (e) call `forge parse-agent pm --file ... --expected-decision-id ...`, (f) only if both
  schema validation and the cross-check pass, append `{decision_id, ticket, branch, ts}` to
  `$EPIC/.forge/decisions-ledger.json`. The append happens before `run-report.json` is written. No
  `JOURNAL.md` or `DECISIONS.md` write is added.

## Acceptance Criteria

- [ ] `src/orchestrator/decision-id.ts` exports a pure `nextDecisionId(existing: string[]): string`:
      empty list → `D-001`; `["D-001", "D-002"]` → `D-003`; gaps use max+1 (`["D-001", "D-003"]` →
      `D-004`); malformed entries are skipped without throwing; zero-padded width 3 until exceeded,
      then natural width.
- [ ] `src/orchestrator/decisions-ledger.ts` exposes a Zod-validated reader and a single appender
      behind an injected IO seam. Missing file → empty ledger. Invalid file shape → a clear typed
      failure (not a silent empty). The ledger schema is exactly
      `{ decisions: [{ decision_id, ticket, branch, ts }] }`.
- [ ] `src/orchestrator/packets.ts`: `PMPacket.inputs` gains `assigned_decision_id: string | null`,
      defaulted to `null` in the generated skeleton. `generateRunPackets` does not fill it.
- [ ] `src/orchestrator/dispatch.ts`: `buildPmDispatch` accepts the pinned id and fails closed with
      `{ ok:false, code:"ASSIGNED_DECISION_ID_REQUIRED" }` when it is absent. On success the rendered
      PM prompt contains an authoritative "## Assigned decision_id (authoritative — use verbatim,
      never invent)" section pinned to the assigned value.
- [ ] `src/cli/run.ts`: `forge dispatch pm` accepts `--assigned-decision-id <D-NNN>` (required for the
      `pm` role); `forge parse-agent pm` accepts an optional `--expected-decision-id <D-NNN>` and,
      after successful schema validation, exits 1 with the failure code `DECISION_ID_MISMATCH` if the
      emitted id does not equal the expected value. Without the flag, behavior is unchanged.
- [ ] `agents/forge-pm.md`: a new output rule states that `decision_id` is Core-pinned — the agent
      reads the value from the dispatch packet's "## Assigned decision_id (authoritative …)" section
      and emits it verbatim, never invents or renumbers it. The example line becomes
      `decision_id: <pinned>  # use the value pinned in the dispatch packet, never invent`.
- [ ] `src/agents/charter-output-format.test.ts` extends with assertions that the new pin-and-echo
      rule wording is present in `agents/forge-pm.md`.
- [ ] `commands/forge-run-ticket.md` step 9 is updated to wire: (a) ledger read via Core, (b) next-id
      compute via Core, (c) `--assigned-decision-id` on `dispatch pm`, (d) `--expected-decision-id` on
      `parse-agent pm`, (e) ledger append after both validations pass and before `run-report.json` is
      written. No `JOURNAL.md` or `DECISIONS.md` write is added.
- [ ] `src/orchestrator/pm-dispatch.test.ts` (and/or `dispatch.test.ts`) gains: (i) happy-path with a
      pinned id renders the authoritative section verbatim; (ii) absent pinned id →
      `ASSIGNED_DECISION_ID_REQUIRED`; (iii) integration replay simulating two ledger entries yields
      `D-001` then `D-002`.
- [ ] `src/cli/run.test.ts` gains: (i) `parse-agent pm` with `--expected-decision-id` matching → exit
      0; (ii) mismatch → exit 1 with `DECISION_ID_MISMATCH`; (iii) no flag → unchanged behavior; (iv)
      `dispatch pm` missing `--assigned-decision-id` → exit 1 with `ASSIGNED_DECISION_ID_REQUIRED`.
- [ ] `src/agents/schemas.ts`, `src/agents/parse-output.ts`, and `src/agents/index.ts` are unchanged
      (git diff empty for those three files).
- [ ] `pnpm test` and `pnpm typecheck` pass.
