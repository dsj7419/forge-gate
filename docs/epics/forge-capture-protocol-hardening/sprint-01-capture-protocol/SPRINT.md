# Sprint 01 — Capture-protocol hardening

**Epic:** forge-capture-protocol-hardening
**Status:** active
**Integration base:** main

## Goal

Move the one-action-per-step agent-output capture rule from a memory/process expectation into the actual run
protocol text (`commands/forge-run-ticket.md`) and lock it with a test, so future runs cannot silently drift
back into pre-writing, summarizing, reconstructing, or composing agent-output files.

## Tickets

- **T01** — Harden agent-output capture protocol (A1 protocol text + A2 protocol-lock test).

## Halt-triggers

Any change outside T01's `allowed_paths`; any edit to the parser/schemas (`src/agents/**`), run-report
(`src/run-report/**`), orchestrator Core (`src/orchestrator/**`), or the CLI router (`src/cli/run.ts`); any
new CLI command or `capture-agent` implementation (that is the deferred Option B); any run-report schema
change (deferred Option C / Phase 1c); a failing verify command after the correction cap.
