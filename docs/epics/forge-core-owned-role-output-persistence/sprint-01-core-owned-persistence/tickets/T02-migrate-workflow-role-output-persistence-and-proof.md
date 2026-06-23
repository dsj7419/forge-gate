---
schema_version: 1
id: T02
title: Move workflow role-output persistence onto the Core parse-agent --out surface (proof-gated)
kind: green
risk: medium
change_class: refactor
blast_radius: module
status: merged
depends_on:
  - T01
blocks: []
allowed_paths:
  - workflows/forge-run-ticket.workflow.js
  - src/workflows/**
  - docs/epics/forge-core-owned-role-output-persistence/**
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - src/cli/**
  - src/cli.ts
  - src/index.ts
  - src/agents/**
  - src/orchestrator/**
  - src/repo/**
  - src/guard/**
  - src/run-report/**
  - src/schema/**
  - src/validate/**
  - src/importer/**
  - src/install/**
  - src/fs/**
  - scripts/**
  - agents/**
  - commands/**
  - .claude/**
  - vitest.config.ts
  - tsconfig.json
  - package.json
  - pnpm-lock.yaml
  - README.md
  - docs/governance/**
  - "**/.forge/**"
  - sandbox-epic/**
  - pilot-local/**
  - templates/**
  - .github/**
---

# T02 — Move workflow role-output persistence onto the Core `parse-agent --out` surface (proof-gated)

## Scope

Replace the workflow's Write-tool persistence of the four role-output artifacts (engineer, semantic-verifier,
scope-verifier, PM) with Core-owned persistence via the T01 surface: `forge parse-agent <role> --json-stdin --out
"<.forge/<role>-output.json>"`. After this, the `forge-core-runner` sub-agent's only persistence action is a Bash
`forge` command — Core does the `fs` write — so no generic agent issues a Write-tool action that stamps a verdict.
**Depends on T01** (the `--out` surface must exist first).

## Core invariant (the reason this ticket exists)

> No generic sub-agent writes another role's verdict artifact via a Write-tool action. Every role-output artifact is
> persisted by Core (validate-then-write) through `parse-agent <role> --json-stdin --out`. The `.forge/<role>-output.json`
> destination paths are unchanged, so PM dispatch and run-report consume them untouched. The verdict stays real and
> role-produced (the workflow's typed `agent({schema})` return); Core-authoring tracks provenance, it does not assert
> the verdict is true.

## The merge gate (load-bearing — read first)

**Unit tests and the governed self-run can prove correctness, containment, and that the old Write path is gone —
but they CANNOT prove the new path clears the built-in classifier.** A Workflow script has no filesystem access, so
the verdict bytes still transit the sub-agent's command (stdin). Phase 0 grounded that the *current* Write path
denies; whether the new Bash-`forge` shape denies is **unproven**. Therefore:

> **T02 is NOT merge-ready until an in-context Phase 1 proof shows the migrated path does not reproduce the
> classifier denial.** The governed self-run reaching a commit-gate PASS on unit tests + verifiers + PM is
> necessary but **not sufficient** for merge.

This proof is a **human-gated, separate step** (it cannot be a `verify_command` — it requires a fresh
launcher-launched session). It is enforced at merge review, not at the commit gate.

## Discovery findings (inspected, not assumed; baseline `6cd0440`)

1. **Current persistence is `writeForgeFile` (a core-runner Write).** `workflows/forge-run-ticket.workflow.js:215-230`
   dispatches the core-runner with *"Write the following exact JSON bytes to file X"* — the **denied** action.
   `persistAndValidateRole` (`:333-339`) calls `writeForgeFile` then a separate `forge parse-agent <role>
   --json-file` validation. The four role outputs persist via this path (engineer/pm through
   `persistAndValidateRole`; semantic at `:604`, scope at `:612`).
2. **Consumers read by path.** PM dispatch: `fs.readFileSync(pmInputs.engineer|semantic|scope|facts)`
   (`src/cli/run.ts:218-221`). run-report: `io.readFileIfExists(inputs.<role>)` (`src/run-report/cli.ts:227`),
   `MISSING_INPUT` if absent. Keeping the same `.forge/<role>-output.json` paths means **no consumer change**.
3. **`orchestrator-facts.json` is workflow-authored, not a role verdict** — left on its current path this epic
   (ratified out of scope).

## Required workflow change

For each of the four role outputs, replace `writeForgeFile(<file>, obj)` + the separate `parse-agent --json-file`
validation with a **single** core-runner Bash invocation:

```
forge parse-agent <role> --json-stdin --out "<epic>/.forge/<role>-output.json"
```

piping the serialized validated-candidate object on stdin (pm adds `--expected-decision-id <D-NNN>`). The script
trusts **only** Core's returned result. The workflow still never writes a file itself. `writeForgeFile` is no longer
used for the four role outputs.

## AI Instructions

- TDD: update/extend the workflow source-level protocol test under `src/workflows/**` (RED first) to assert the new
  persistence shape, then change `workflows/forge-run-ticket.workflow.js`.
- Keep the destination paths identical (`.forge/<role>-output.json`). Do **not** change Core, charters, commands, or
  any consumer — they read the same paths.
- Leave `orchestrator-facts.json` on its current persistence path (out of scope this epic).
- Do not touch any forbidden path. If the change appears to require a Core edit, **stop and report** (T01 owns Core;
  a Core gap is a re-scope back to T01).
- `pnpm test` and `pnpm typecheck` green; scope guard clean.

## Acceptance Criteria

_AC 1–12 are satisfiable in the governed self-run; AC 13–15 (Merge gate, below) are not._

1. The workflow **no longer uses** `writeForgeFile` to persist `engineer-output.json`.
2. The workflow **no longer uses** `writeForgeFile` to persist `semantic-verifier-output.json`.
3. The workflow **no longer uses** `writeForgeFile` to persist `scope-verifier-output.json`.
4. The workflow **no longer uses** `writeForgeFile` to persist `pm-output.json`.
5. The workflow invokes Core `parse-agent <role> --json-stdin --out` for each of the four role outputs.
6. The `.forge/<role>-output.json` destination paths are **unchanged**.
7. PM dispatch consumes the **unchanged** paths.
8. run-report consumes the **unchanged** paths.
9. No permission carve-out; no hook weakening.
10. No fake verdict artifacts; no status-write-back; no journal-write.
11. A **non-tautological** workflow protocol test locks the new shape (and that the old Write path is gone), genuinely
    **RED before** the change.
12. `pnpm test` and `pnpm typecheck` pass; scope guard clean (only `allowed_paths` change).

## Merge gate (NOT satisfiable by unit tests — required before merge)

13. An **in-context Phase 1 proof** is run in the hook-less launcher substrate against a disposable clone, exercising
    the **migrated** persistence path with a **real, gate-consumed scope-verifier verdict**.
14. **Proof criterion:** if a classifier denial still occurs on the new Core-owned persist path → **stop and
    escalate** (do not merge). If the new path persists cleanly across the PM-ratified proof sample (no denial) →
    record the proof and proceed to merge review.
15. The proof result is recorded (gitignored evidence + a short finding) and reviewed by the PM **before** any merge.

## Verification

- RED→GREEN evidence; full `pnpm test` / `pnpm typecheck`; scope guard clean.
- Governed two-pass verifiers review the diff for the invariant (no core-runner Write of a verdict; Core-owned
  persist for all four; unchanged paths; consumers untouched) and additivity; PM judges → commit-gate PASS.
- **Then, before merge:** the human-gated in-context Phase 1 proof (AC 13–15). The commit-gate PASS is necessary but
  not sufficient.
- **No install refresh** post-merge: none of `commands/**`, `agents/**`, or `README.md` is touched. (The workflow
  path uses registered agentTypes, not installed charters.)

## Ratified decisions (PM — Dan, 2026-06-17)

1. **Input mode → `--json-stdin`** (avoid a temp-file input — it reintroduces a verdict Write).
2. **Scope → all four role outputs** (engineer, semantic-verifier, scope-verifier, PM).
3. **`orchestrator-facts.json` → unchanged** this epic (workflow-authored, not a role verdict).
4. **Proof gate → required before MERGE of T02**, not before authoring the contract and not for T01.
5. **`.yaml` vs `.json` run-report naming cleanup → separate**, not part of this epic.

## Ratified implementation decisions (PM — Dan, 2026-06-17)

1. **Transport → RATIFIED: `--json-stdin` is the required path.** Do **NOT** fall back to `--json-file <tmp>`
   without PM re-ratification — a temp-file input reintroduces the denied verdict-Write shape. If the bridge cannot
   pipe stdin cleanly, **stop and report**.
2. **Phase 1 proof sample (N) → deferred until T02 implementation is ready.** The contract keeps the in-context
   Phase 1 proof as a **merge gate** (AC 13–15) regardless of N; the exact sample size is set at proof time
   (cf. Phase 0 N=3 max).
