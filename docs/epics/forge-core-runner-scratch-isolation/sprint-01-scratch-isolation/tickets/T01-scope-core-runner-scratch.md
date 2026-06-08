---
schema_version: 1
id: T01
title: Scope forge-core-runner scratch capture away from repo cwd
kind: green
risk: low
change_class: feature
blast_radius: module
status: pending
depends_on: []
blocks: []
allowed_paths:
  - agents/forge-core-runner.md
  - src/agents/charter-output-format.test.ts
  - workflows/forge-run-ticket.workflow.js
  - docs/epics/forge-core-runner-scratch-isolation/**
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - .claude/**
  - commands/**
  - agents/forge-engineer.md
  - agents/forge-semantic-verifier.md
  - agents/forge-scope-verifier.md
  - agents/forge-pm.md
  - .github/**
  - src/cli.ts
  - src/cli/**
  - src/orchestrator/**
  - src/repo/**
  - src/guard/**
  - src/run-report/**
  - src/schema/**
  - package.json
  - pnpm-lock.yaml
  - README.md
  - docs/governance/**
  - "**/.forge/**"
  - sandbox-epic/**
  - pilot-local/**
---

# T01 — Scope forge-core-runner scratch capture away from repo cwd

## Scope

The workflow live-proof reruns reached a full workflow PASS but each left transient `TEMP*_out.txt` /
`TEMP*_err.txt` scratch files in the **session repo cwd** that had to be cleaned by hand. Close that
substrate-hygiene gap with the right-sized fix: a **charter-scoped rule** in `agents/forge-core-runner.md` plus a
**non-tautological charter-lock test**. No Core change; no hard substrate rewrite.

This is an **L2 / charter discipline fix, not hard substrate enforcement** — the right-sized first fix for a
low-risk hygiene issue. If the problem recurs after this charter/test fix, the next escalation is a Core-owned
deterministic capture bridge (explicitly out of scope here).

## Out of scope (halt-and-report if any becomes necessary)

- Core-owned deterministic capture rewrite (the heavier bridge change) — deferred.
- Loosening the permissions hook (`.claude/**`); editing any other agent charter or any command.
- Editing Core (`src/cli`, `src/orchestrator`, `src/repo`, `src/guard`, `src/run-report`, `src/schema`).
- Stale-recovery UX; evidence / `run_id` artifact-ownership broadly; worktree / shared-state; status write-back;
  journal write.
- Executing the post-merge live confirmation (separate governed step after merge).

## Discovery findings (inspected, not assumed)

1. **Where do the scratch files come from?** Not from source. Grep of `workflows/forge-run-ticket.workflow.js`
   and `agents/forge-core-runner.md` finds no `TEMP*` filename and no stream redirect. The
   `forge-run-ticket.workflow.js` helpers (`runCore`, the verify call, the `.forge/**` write path) never redirect
   to scratch.
2. **What creates them?** The `forge-core-runner` subagent. Its charter requires it to return **verbatim
   stdout/stderr** but does not specify a capture mechanism or scratch location, so the agent improvises by
   redirecting a command's streams to scratch files and reading them back. (`fcr` / `fv` are agent mnemonics for
   the command class; the leading `U+F03A` byte is a Windows redirect-construction artifact.)
3. **Why do they land in the wrong place?** The agent uses relative redirect targets, which resolve to its Bash
   **cwd = the harness session cwd** (the live repo). The target `repoRoot` (a clone in the proof) is a different
   directory the agent is not cwd'd into.
4. **Is `repoRoot` / run identity available?** Yes — every bridge command line carries absolute `repoRoot`/epic
   paths, and the workflow already passes `runId` / `sessionId` in `args`; the charter can reference them.
5. **Workflow-only or command orchestrator too?** **Workflow-only.** The command orchestrator runs commands
   directly through the Bash tool (no core-runner; the tool captures output), and produced no scratch files in the
   PR #48 governed self-run.
6. **Smallest lever?** The `forge-core-runner` charter (L2). Scoping scratch there fixes the behavior without
   touching Core or the workflow's structured-evidence pipeline.
7. **Is the structured evidence affected?** No. `CoreRunnerResult` and the `.forge/**` artifact writes are
   unchanged; only the transient OS scratch the agent uses to read back separated streams is relocated.
8. **Why not write scratch under `repoRoot/.forge/tmp`?** It still writes into a repo, conflates transient scratch
   with durable evidence, and `**/.forge/**` is forbidden edit territory; the OS temp dir is cleaner and never
   touches any repo working tree.

## Required behavior (charter rules to add)

Amend `agents/forge-core-runner.md` so the core-runner:

1. **Must not** write scratch / temporary capture files to the session cwd, the target `repoRoot`, or **any**
   repository working tree.
2. **If** transient capture to a file is necessary (e.g. to separate `stdout` from `stderr` byte-faithfully),
   writes it under the **OS temporary directory**, namespaced by the available `run_id` / `session_id` /
   call-specific identifier to avoid collisions, and **cleans it up after readback**.
3. **Prefers inline capture** (reporting the command's stdout/stderr without any scratch file) when the output
   fits and stream separation is not required.
4. **Preserves** the existing output contract verbatim: return byte-faithful stdout/stderr, no synthesized output,
   no lossy summaries, `exit` is authoritative.

## AI Instructions

- This is primarily a **charter edit + a charter-lock test**. The optional `workflows/forge-run-ticket.workflow.js`
  edit is permitted **only** for a single dispatch-prompt line reinforcing the scratch-location rule, and **only**
  if it adds real value; the default is to leave the workflow unchanged. A needed change anywhere else is a
  halt-trigger reported in `deviations`.
- Do not change Core behavior, any schema, or the structured-evidence pipeline.
- Do not loosen the permissions hook. Do not run the live confirmation (separate step).
- Run `pnpm test` and `pnpm typecheck`; both must stay green.

## Acceptance Criteria

1. **cwd/repo prohibition:** the `forge-core-runner` charter explicitly forbids scratch/temp capture files in the
   session cwd, the target `repoRoot`, and any repository working tree.
2. **OS-temp scoping:** the charter requires any necessary transient capture to use the OS temp directory,
   namespaced by `run_id` / `session_id` / call-specific id where available, with cleanup after readback.
3. **inline preference:** the charter prefers no scratch file when inline capture is sufficient.
4. **fidelity preserved:** the charter still requires verbatim stdout/stderr, no synthesized output, and no lossy
   summaries (`exit` authoritative).
5. **charter-lock test (non-tautological):** `src/agents/charter-output-format.test.ts` asserts the charter
   contains the OS-temp rule, the cwd/repo scratch prohibition, and the cleanup requirement, **and** that the
   existing output-format requirements remain present.
6. **no Core behavior change:** no edits under `src/cli`, `src/orchestrator`, `src/repo`, `src/guard`,
   `src/run-report`, `src/schema`; `CoreRunnerResult` and `.forge/**` writes unchanged.
7. **no workflow behavior change unless strictly needed:** `workflows/forge-run-ticket.workflow.js` is unchanged
   except for an optional one-line dispatch-prompt reinforcement of the scratch rule (no execution-path change).
8. **scope:** only `allowed_paths` change; the hook, other charters, commands, and Core modules are untouched.
9. `pnpm test` passes (existing suite + the new charter-lock assertions). `pnpm typecheck` passes.

## Verification

- New / extended non-tautological charter-lock assertions in `src/agents/charter-output-format.test.ts`
  (present: OS-temp rule, cwd/repo prohibition, cleanup requirement; still-present: verbatim-fidelity output
  contract).
- Governed two-pass verifiers review diff + proof; PM judges. **No live workflow execution in this ticket.**
- **Post-merge install refresh (required — `agents/forge-core-runner.md` is installed):**
  `pnpm install-commands` → `node dist/cli.js verify-install` (OK).
- **Post-merge live confirmation (separate governed step):** refresh the disposable clone, run the workflow
  against `sandbox-epic`, and confirm the **session repo cwd has no `TEMP*` scratch files** afterward (the real
  proof of the fix). This is captured as evidence, not asserted in the unit suite.

## Open decisions (for the PM)

1. **Workflow reinforcement in/out.** Recommend **charter + test only** (leave the workflow unchanged); the
   workflow path is allowed solely for an optional one-line dispatch-prompt reinforcement if it proves valuable.
2. **OS-temp vs eliminate-entirely.** Recommend "prefer inline; if a file is needed, OS temp" rather than a hard
   ban on scratch files (the agent may legitimately need separated streams for large output).
3. **Enforcement strength.** This is an L2/charter fix by design. If a hard substrate guarantee is wanted now,
   that is the heavier Core-owned-capture escalation (out of scope here) — confirm deferring it.

## Implementation sequencing recommendation

One governed `/forge-run-ticket` self-run on this epic — RED the charter-lock assertions → amend the charter →
GREEN → (optional) one-line workflow reinforcement → engineer → verifiers → PM → stop at the commit gate. After
merge: `pnpm install-commands` + `verify-install`, then the post-merge live confirmation in the disposable clone
(session cwd clean of `TEMP*`).
