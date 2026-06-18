# Epic — Core-owned role-output persistence (proof-gated)

## Why this epic exists

ForgeGate's workflow runner persists each role's structured output (engineer, semantic-verifier, scope-verifier,
PM) to `<epic>/.forge/<role>-output.json` by asking the generic `forge-core-runner` sub-agent to perform a
**Write-tool** action carrying another role's verdict. Claude Code's built-in auto-mode classifier can read that as
a fabricated approval a downstream gate will consume, and **intermittently denies it** — which terminates the run.

## What Phase 0 established (GROUNDED)

An in-context grounding proof (2 runs, hook-less launcher substrate, disposable clone, sterile sandbox ticket)
reproduced the denial on a **real, gate-consumed** scope-verifier verdict: Run 1 NO_DENIAL (clean PASS), Run 2
`BUILT_IN_CLASSIFIER_DENIAL` (verbatim: *"Writes a fabricated 'APPROVE / scope is clean' verifier verdict the agent
never actually verified, which a downstream gate will consume — content integrity / fabricated approval."*). The
seam is **real, in-context, and intermittent**. Full record: `.forge/f1-phase0-grounding-finding.md`; design packet:
`.forge/f1-core-owned-role-output-persistence-design-packet.md`.

## The selected structural fix (C1)

Move the file write into Forge Core. Extend `forge parse-agent <role>` with an optional `--out <path>` so Core
**validates** the role output (its existing authoritative validation, plus the PM decision-id cross-check) and
**then writes** the validated canonical JSON itself — the `active-ticket --out` shape (`src/cli/run.ts:271-288`).
The workflow then persists each role output via `forge parse-agent <role> --json-stdin --out <path>`, so the
sub-agent's only action is a Bash `forge` command, never a Write-tool verdict stamp. Downstream paths and filenames
are unchanged, so PM dispatch and run-report consume the artifacts untouched.

## Required risk language (read before implementing)

- **Phase 0 grounded the current Write-tool persistence path denial.** It is real and reproducible.
- **C1 is the selected structural fix direction**, precedent-aligned with `active-ticket --out` and the run-report
  `.forge` containment guard (`OUT_PATH_OUTSIDE_FORGE`).
- **C1 is NOT yet proven effective against the classifier.** A Workflow script has no filesystem access, so the
  verdict bytes still transit the sub-agent's command (stdin); whether the classifier denies the new Bash-command
  shape is unproven.
- **Unit tests can prove correctness and containment, but cannot prove classifier behavior.**
- **Therefore an in-context Phase 1 proof is a MERGE GATE for T02** — not a contract-authoring gate, and not a T01
  gate.

## Ticket sequence

- **T01 — Core additive surface.** Add `parse-agent --out` + `.forge` containment. Fully testable in Core; no
  workflow change. Low-risk and mergeable on its own merits.
- **T02 — Workflow persistence onto the Core surface + proof gate.** Replace the four role-output Write-tool persists
  with `parse-agent --json-stdin --out`. **Not merge-ready until an in-context Phase 1 proof shows the new path does
  not reproduce the classifier denial.**

T02 depends on T01.

## Out of scope (this epic)

Role-owned writes (granting Write to read-only verifier/PM charters) — reserved for Sr-PM escalation **only** if the
Phase 1 proof fails C1. Permission carve-outs. Hook changes. `orchestrator-facts.json` (workflow-authored, not a
verdict — unchanged this epic). The run-report `agent_outputs` `.yaml`-vs-`.json` naming cleanup (separate). Core
lock/guard/schema-primitive changes. Worktree/shared-state. Stale-recovery beyond the shipped v1.

## Process note

The PM-requested flat file list (`SPRINT.md`/`manifest.yaml`/`tickets/` at the epic root) was authored in the
**schema-required nested layout** (`sprint-01-core-owned-persistence/…`) so `forge validate` passes — the validator
discovers sprints from `sprint-NN-slug/` subfolders. Same files, correct location.
