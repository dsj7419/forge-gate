# Epic — Harden the agent-output capture protocol

**Status:** active
**Integration base:** main

## Why

The B1 (`forge-gate-provenance`) arc twice surfaced the same process failure: the orchestrator composed
agent-output YAML and wrote it to the capture path instead of transcribing the dispatched agent's real Task
return — once as outright fabrication (the tainted first run, reset), once as a milder "pre-write in a batched
turn, then correct." Both were caught and disclosed before any commit, but the rule that prevents them lives
only in memory as a discipline expectation. Nothing in the run protocol or its tests structurally channels
capture into one auditable, verbatim action.

The seam: `forge parse-agent` validates *content vs schema* (strict, never-repair) but it cannot prove the
bytes it validates came from the actual agent return — composed text and a real return are indistinguishable
to it. Core attests schema validity; it cannot observe the Task return. So capture fidelity, like the human
gate, is "durable if adapted": prevention belongs to the substrate (the protocol the orchestrator follows),
and the smallest effective hardening is to (a) make the one-action-per-step discipline explicit in the
authoritative command text and (b) lock that text with a test so it cannot silently drift back.

## What (Option A only)

- **A1** — harden the capture-step language in `commands/forge-run-ticket.md`: a top-level capture-discipline
  section + the explicit `dispatch → wait → capture verbatim → parse-agent → continue` sequence at each agent
  step, plus the explicit prohibitions (no pre-write / summarize / reconstruct / compose / batch / validate
  synthesized output) and halt-on-malformed behavior.
- **A2** — add a protocol-lock test (`src/commands/forge-run-ticket-protocol.test.ts`) that reads the command
  markdown and asserts the required discipline language is present, modeled on the existing
  `src/agents/charter-output-format.test.ts` precedent. If a future edit drops the discipline, the suite goes
  red.

This narrows and locks the *instruction* and makes drift auditable; it does not make a non-compliant
orchestrator structurally impossible — that stronger guarantee belongs to the deferred Option B
(`forge capture-agent` / workflow `core-runner` deterministic write) and the workflow runner itself.

## Out of scope

- **Option B** — a deterministic `forge capture-agent` / `core-runner` write path. Deferred to
  workflow-runner / core-runner design.
- **Option C** — run-report capture-method auditability. Deferred to Phase 1c / a dedicated run-report schema
  ticket (touches the frozen `forge-run-report/v1`).
- Any change to the parser, schemas, run-report, orchestrator Core modules, or CLI surface.
- Any new CLI command.
- B2 (decision-id assignment provenance) and the workflow runner.

## Sprints

- **sprint-01-capture-protocol** — A1 protocol-text hardening + A2 protocol-lock test (T01).
