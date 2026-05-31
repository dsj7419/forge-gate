---
schema_version: 1
id: T01
title: Harden agent-output capture protocol
kind: green
status: pending
risk: low
change_class: docs
blast_radius: local
depends_on: []
blocks: []
allowed_paths:
  - commands/forge-run-ticket.md
  - src/commands/forge-run-ticket-protocol.test.ts
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - src/agents/**
  - src/run-report/**
  - src/orchestrator/**
  - src/cli/run.ts
  - src/cli/active-ticket.ts
  - src/guard/**
  - src/validate/**
  - src/install/**
  - src/schema/**
  - src/run/**
  - src/fs/**
  - src/importer/**
  - agents/**
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

# T01 — Harden agent-output capture protocol

## Scope

Move the one-action-per-step agent-output capture rule from a memory/process expectation into the actual
ForgeGate run protocol text, and lock it with a test so future runs cannot silently drift back into
pre-writing, summarizing, reconstructing, or composing agent-output files. Option A only.

Two changes:

1. **A1 — harden `commands/forge-run-ticket.md`.** Add a top-level capture-discipline section and make every
   agent capture step (engineer, the two verifiers, PM) follow the exact sequence:
   **dispatch agent → wait for the actual agent return → capture the exact returned text verbatim to the
   canonical `.forge/<role>-output.yaml` file → run `forge parse-agent` → continue only after parse
   succeeds.** State the prohibitions and halt behavior explicitly (below).

2. **A2 — add `src/commands/forge-run-ticket-protocol.test.ts`** (new `src/commands/` test dir). It reads
   `commands/forge-run-ticket.md` and asserts the required capture-discipline phrases are present, so a future
   edit that drops the discipline turns the suite red. Model it on the existing
   `src/agents/charter-output-format.test.ts` lock-test style (assert the load-bearing phrases, not an
   exact-string match of an entire paragraph, to avoid brittleness on trivial copy edits).

## Required protocol language (A1)

The command MUST explicitly require, for each agent step:

- dispatch the agent
- wait for the actual agent return
- capture the exact returned text verbatim
- write that verbatim return to the canonical `.forge/<role>-output.yaml` file
- run `forge parse-agent`
- continue only after parse succeeds

The command MUST explicitly prohibit:

- pre-writing agent-output files (before or alongside the dispatch)
- summarizing agent output into replacement YAML
- reconstructing malformed output
- composing schema-valid output on behalf of an agent
- batching dispatch + capture + parse into the same step
- validating synthesized output

The command MUST state halt behavior:

- if the agent output is malformed, parse it as malformed and halt (`AGENT_OUTPUT_INVALID`)
- if the agent output is missing required fields, halt
- if tests fail, report fail
- if a verifier rejects, report reject
- never rewrite an agent response to make it parse

## Out of Scope

- **Option B** — a deterministic `forge capture-agent` / `core-runner` write path. Not in this ticket;
  deferred to workflow-runner / core-runner design. **Do not add any new CLI command or capture
  implementation.**
- **Option C** — run-report capture-method auditability. Deferred to Phase 1c / a dedicated run-report ticket.
- Any change to `src/agents/**` (parser, schemas, charters), `src/run-report/**`, `src/orchestrator/**`,
  `src/cli/run.ts`, `src/guard/**`, `src/schema/**`. The capture machinery itself is unchanged — only the
  protocol *instruction* and its lock test change.
- `docs/forge-run-ticket-design.md` and `README.md` are intentionally **not** in `allowed_paths`: their
  existing capture mentions are high-level summaries that remain accurate under the tightened protocol (they
  do not become stale or contradictory), so they stay untouched to keep scope minimal.

## AI Instructions

- TDD: add the protocol-lock test FIRST as RED (it should fail against today's command wording, which lacks
  the explicit discipline phrases), then edit `commands/forge-run-ticket.md` to GREEN. Do not weaken the test
  to pass.
- Edit ONLY the two `allowed_paths` files. `commands/forge-run-ticket.md` is intentionally in scope for this
  ticket (it is normally forbidden) — this is the first ticket whose subject *is* the command; do not take it
  as license to touch any other `commands/**` or `docs/**` file.
- The lock test must assert the load-bearing discipline phrases (representative-phrase sweep), not an exact
  paragraph match — mirror `src/agents/charter-output-format.test.ts` for tolerance.
- Create the new directory `src/commands/` for the test. Add only the lock test there — no runtime modules.
- Do not add a `forge capture-agent` command or any new CLI surface. Do not change the parser/schemas.
- Keep the README's anti-overclaiming voice: the protocol text should state honestly that this discipline is
  enforced by instruction + lock test (and disclosed-departure auditability), not that Core structurally
  prevents a non-compliant capture.

## Acceptance Criteria

1. `commands/forge-run-ticket.md` contains a top-level capture-discipline section.
2. The engineer, verifier, and PM capture steps all follow `dispatch → wait → capture verbatim →
   parse-agent → continue`.
3. The command explicitly forbids pre-writing, summarizing, reconstructing, or composing agent-output files.
4. The command explicitly forbids batching dispatch + capture + parse in one step.
5. The command states that malformed or missing agent output halts instead of being repaired.
6. The command states that test failure / verifier rejection are reported honestly and not rewritten.
7. A protocol-lock test (`src/commands/forge-run-ticket-protocol.test.ts`) reads
   `commands/forge-run-ticket.md` and asserts the capture-discipline language exists (and would fail if it
   were removed).
8. No parser / schema / run-report / orchestrator behavior changes (those paths are unchanged; diff-empty).
9. No new CLI command or `capture-agent` implementation is added.
10. The `verify-install` implication is documented in the command (or its run-report handoff note): because
    `commands/forge-run-ticket.md` is an installed file, after merge an install refresh is expected and
    `verify-install` will report it stale until `pnpm install-commands` is re-run.
11. The bootstrap nature is documented: this ticket edits the command being executed, so the self-run is
    governed by the previously-installed command text plus the memory rule; only after merge + install refresh
    does the command text itself enforce the protocol.
12. `pnpm test` and `pnpm typecheck` pass.
