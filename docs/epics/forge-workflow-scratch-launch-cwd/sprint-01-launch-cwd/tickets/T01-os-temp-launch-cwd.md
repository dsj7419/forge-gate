---
schema_version: 1
id: T01
title: Run ForgeGate workflows from a Forge-owned OS-temp launch cwd
kind: green
risk: medium
change_class: feature
blast_radius: cross_module
status: pending
depends_on: []
blocks: []
allowed_paths:
  - scripts/launch-workflow.mjs
  - workflows/forge-run-ticket.workflow.js
  - src/workflows/**
  - README.md
  - commands/forge-run-ticket.md
  - docs/epics/forge-workflow-scratch-launch-cwd/**
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - .claude/**
  - agents/**
  - src/orchestrator/**
  - src/repo/**
  - src/guard/**
  - src/run-report/**
  - src/schema/**
  - src/agents/**
  - src/validate/**
  - src/importer/**
  - src/install/**
  - src/fs/**
  - src/cli/**
  - src/cli.ts
  - src/index.ts
  - scripts/run-forge-cli.mjs
  - scripts/install-commands.mjs
  - vitest.config.ts
  - tsconfig.json
  - package.json
  - pnpm-lock.yaml
  - docs/governance/**
  - "**/.forge/**"
  - sandbox-epic/**
  - pilot-local/**
  - templates/**
  - .github/**
---

# T01 — Run ForgeGate workflows from a Forge-owned OS-temp launch cwd

## Scope (PM-ratified decisions encoded)

Encode the live-proven prevention as ForgeGate's permanent, **enforceable** launch layer for workflow runs:

1. **Launcher script (ratified — option B):** a small wrapper `scripts/launch-workflow.mjs` — the operational
   layer that creates the Forge-owned OS-temp scratch cwd, hands the workflow absolute paths plus the scratch-cwd
   expectation, runs the pre/post `TEMP*` scans, writes evidence, and cleans up only its own scratch. Core does
   not gain a CLI surface and does not invent workflow metadata.
2. **Workflow-side fail-closed launch-cwd gate (ratified — IN, strict):** `workflows/forge-run-ticket.workflow.js`
   requires a launcher-declared scratch-cwd expectation and verifies the observed launch cwd **before checkpoint,
   lock acquire, branch use, active-ticket emission, or any mutation**, failing closed with a typed escalation
   code when unsafe. Strict: enforcement is not optional-when-provided.
3. **Documented operator procedure (ratified — README + pointer):** `README.md` operator section plus a short
   pointer in `commands/forge-run-ticket.md`. No large new docs file.

This is operational workflow-launch infrastructure. It does NOT change Core execute/capture, the permissions hook,
the lock/ledger/guard/run-report/schema modules, or any role charter.

## Out of scope (halt-and-report if any becomes necessary)

- Core execute-capture redesign (explicitly rejected by the proof — not needed).
- Any change under `.claude/**` (the hook is untouchable in this ticket; no loosening, no tightening).
- Any charter edit (`agents/**`) — PR #51's scratch rule stays intact as L2 documented intent.
- Any change to lock semantics, ledger, guard, run-report, schemas, Core CLI, or `vitest.config.ts`/`package.json`.
- A post-run sweep presented as the fix — a sweep may exist only as cleanup of Forge-owned scratch.
- Outward git/gh actions in any documented step without explicit human approval.

## Discovery findings (inspected and live-proven, not assumed)

1. **Producer (evidence-backed):** the harness Bash-tool output-capture wrapper writes `TEMP*_out/_err` pairs into
   the **subagent process cwd = the Claude launch cwd** — below the charter (L2) and below workflow command-shape
   control (the `runCore` prompt already cd's to `repoRoot`; the scratch still landed in the session cwd).
   Reference (gitignored): `.forge/core-runner-capture-bridge-discovery.md`.
2. **Charter rule insufficient (live-proven):** with the PR #51 charter installed and `verify-install` OK, a clean
   workflow run (`wf_a5da3336-3fc`) still left scratch pairs in the session repo cwd. This is why the gate is
   ratified IN: documented procedure alone is the same L2 layer that already failed for this class.
3. **Substrate facts (spike, 2026-06-08):** `cd` does not persist across Bash tool calls; the session cwd is
   immutable mid-session; Agent/Workflow subagents anchor to the launch cwd; no tool parameter sets subagent cwd.
   The only lever is where the `claude` process is started.
4. **The proof (2026-06-09, fresh OS-temp-launched session, both repos @ ff1cc66):** smoke run `wf_edc2bed8-4ec`
   correctly escalated `PREFLIGHT_LOCK_HELD` under a foreign lock; full run `wf_d9d91c55-0c4` (35 agents) reached
   the guard + agent-schema bridge calls (`guard {OK, exit 0}`, `parse_validation` true for all four roles, both
   verifiers APPROVE, tests pass, `safety.*` all false) and `TEMP*` scratch materialized **nowhere** — ForgeGate
   repo, target clone, and launch cwd all ended clean (recursive scan). **Classification: PREVENTION_CONFIRMED.**
   Reference (gitignored): `.forge/scratch-launch-proof-runbook.md` and the proof evidence report.
5. **Run identity already comes from the launcher side:** the workflow requires `runId`/`sessionId` via `args`
   (the script cannot mint them) — the strict scratch-cwd expectation extends this existing required-args pattern.
6. **Test-collection fact (inspected):** `vitest.config.ts` includes only `src/**/*.test.ts`, and the config is
   out-of-fence — so launcher coverage lives in `src/workflows/**` and drives the script as a child process,
   per the existing precedent `src/cli/resolver.integration.test.ts` (which tests `scripts/run-forge-cli.mjs` the
   same way).

## Required behavior

**Launcher (`scripts/launch-workflow.mjs`):**
- Creates a per-run, Forge-owned scratch directory under the OS temp root, namespaced by run identity
  (Windows `%TEMP%` and POSIX temp roots both handled; absolute, normalized paths).
- Ensures the scratch cwd is outside all repo working trees and never inside the target `repoRoot`.
- Mints `runId`/`sessionId`, takes absolute session-repo and target-repo paths, and emits the exact launch
  instruction plus the complete workflow `args` JSON — including the scratch-cwd expectation (e.g. `scratchCwd`).
- Runs the **pre-run** `TEMP*` scan (session repo, target repo, launch cwd) and the **post-run** scan of the same
  three locations; records both.
- Writes evidence — launch cwd, session repo root, target repo root, both HEAD SHAs, run identity, scan results —
  to a gitignored location (the scratch cwd itself and/or the ForgeGate repo's gitignored `.forge/`).
- Cleanup mode clears **only** Forge-owned launch-cwd scratch artifacts; the script's own output states that
  cleanup is hygiene and the prevention claim is launch-cwd placement.
- Never launches Claude itself in test paths; repo facts come hook-free (e.g. via `forge repo snapshot` /
  `node dist/cli.js`), never via shell git in agent contexts.

**Workflow gate (`workflows/forge-run-ticket.workflow.js`):**
- New **required** arg: the launcher-declared scratch-cwd expectation (strict — a launch without it fails closed
  with a typed escalation, same pattern as the existing required `runId`/`sessionId`).
- Before checkpoint, lock acquire, branch use, active-ticket emission, or any mutation: capture the observed
  subagent process cwd via the existing typed `forge-core-runner` bridge (a non-git probe; hook-safe) and verify
  it satisfies the contract — equals the declared scratch cwd (Windows-aware comparison: separator and case
  normalization), lies under the OS temp root, and is not inside the target `repoRoot`.
- Unsafe → fail closed with a dedicated typed code (e.g. `PREFLIGHT_LAUNCH_CWD_UNSAFE`),
  `outward_action_taken: false`: **no lock acquire, no active-ticket write, no branch use, no ledger append, no
  run-report write, no target-source edits.**
- Safe → proceed exactly as today: existing lock ordering, Core-IO (`active-ticket --out`, Core-fed scope diff),
  capture protocol, and escalate shapes unchanged.
- Consequence (by design, strict): a ForgeGate workflow run launched from a session whose cwd is inside a repo
  working tree becomes impossible. Other, non-ForgeGate Workflow-tool scripts are unaffected (the gate lives only
  in `forge-run-ticket.workflow.js`).

**Documentation (`README.md` + `commands/forge-run-ticket.md` pointer):**
- The operator procedure: create scratch dir → start `claude` FROM it (starting elsewhere and changing directory
  later is proven ineffective) → run the launcher → invoke the workflow with the emitted args → post-run scan +
  cleanup. Windows path behavior explicit.
- The verdict-depth rule: any run used as a scratch-placement verdict must reach the guard + agent-schema bridge
  stages; preflight-only is INCONCLUSIVE.
- The hook posture: a scratch-launched session does not load ForgeGate's project-local permissions hook; such
  sessions are restricted to launch-and-prove actions only (no outward git/gh, no source edits).
- The command pointer is one short note; the command's existing protocol text stays untouched (protocol-lock test
  must stay green).

## AI Instructions

- TDD: RED the workflow-gate test first in `src/workflows/**` (non-tautological: gate wiring present + ordering
  before checkpoint/lock/active-ticket + typed escalate code + unsafe path issues no lock acquire), then the
  additive gate; RED launcher tests (child-process, OS-temp sandboxes, no Claude launch), then the launcher.
- Keep the gate additive and surgical; the workflow's existing protocol-locked behavior beyond it is unchanged and
  its existing tests stay green.
- Windows path behavior explicit everywhere (backslash round-trips, `%TEMP%` resolution, normalized comparisons).
- `pnpm test` and `pnpm typecheck` green; scope guard clean.

## Acceptance Criteria

**Workflow fail-closed gate:**
1. The workflow requires a launcher-declared Forge-owned OS-temp scratch-cwd expectation in `args` (strict: a
   launch without it fails closed with a typed escalation).
2. The workflow verifies the observed launch cwd against that expectation **before** checkpoint, lock acquire,
   branch use, active-ticket emission, or any mutation.
3. An unsafe launch cwd fails closed with a dedicated typed escalation code and `outward_action_taken: false`.
4. An unsafe launch cwd never acquires the epic lock.
5. An unsafe launch cwd produces no active-ticket write, no branch creation/use, no ledger append, no run-report
   write, and no target-source edits.
6. A safe launch cwd proceeds normally — existing lock ordering, Core-IO, capture protocol, and escalate shapes
   unchanged.

**Launcher:**
7. Creates a per-run, Forge-owned OS-temp scratch cwd (namespaced by run identity).
8. Ensures the scratch cwd is outside all repo working trees (and never inside the target `repoRoot`).
9. Uses absolute paths for the session repo and the target repo.
10. Passes the scratch-cwd expectation into the workflow `args` (alongside the existing required args).
11. Captures before/after `TEMP*` scans for the session repo, the target repo, and the launch cwd.
12. Writes evidence (launch cwd, both repo roots, both SHAs, run identity, scan results) to a gitignored location.
13. Cleanup clears only Forge-owned launch-cwd artifacts.
14. Cleanup is not accepted or presented as the prevention mechanism — the documented prevention claim is
    launch-cwd placement.

**Documentation:**
15. The README operator procedure exists with the launch steps, Windows path behavior explicit, the
    verdict-depth rule (guard + agent-schema stages; preflight-only = INCONCLUSIVE), and the no-hook posture and
    restrictions for scratch-launched sessions; `commands/forge-run-ticket.md` carries a short pointer and its
    protocol text is otherwise untouched.
16. No outward git/gh action appears in the documented procedure without explicit human approval.

**Tests:**
17. Coverage proves the unsafe-cwd gate fails **before** lock acquire (non-tautological source-level protocol
    test: wiring + ordering + typed code + no-lock-on-unsafe; the established workflow-protocol-test pattern).
18. Coverage proves the safe-cwd path passes the launch-cwd check, and the existing workflow protocol tests stay
    green.
19. Launcher tests drive the real script as a child process in OS-temp sandboxes and do **not** launch Claude.

**Boundaries:**
20. No Core execute-capture redesign; the fenced Core modules, the hook (`.claude/**`), and the charters
    (`agents/**`) are untouched; PR #51's charter rule remains intact as L2 intent.
21. `pnpm test` and `pnpm typecheck` pass; only `allowed_paths` change.

## Verification

- Source-level: the new gate protocol test (ordering + typed code + no-lock-on-unsafe) and launcher child-process
  tests; existing command protocol-lock and workflow protocol tests stay green.
- `pnpm test`, `pnpm typecheck`.
- Governed two-pass verifiers review diff + proof; PM judges. **No live Workflow-tool execution inside this
  ticket's verify steps** (token-heavy; live confirmation is a separate human-approved step).
- **Post-merge operability confirmation (separate, human-approved):** one full workflow run executed via the NEW
  launcher + procedure end-to-end (launch → evidence → scans → cleanup, reaching guard + agent-schema depth),
  confirming the procedure is operable — the permissions-epic lesson: prove operability, not just correctness.
  The gitignored proof runbook is updated operationally to the new launcher at that point.

## Open decisions (for the PM)

1. **Launcher-test home (deviation from your path list, with justification).** You listed
   `scripts/launch-workflow.test.mjs`; authored instead as launcher tests in `src/workflows/**` (e.g.
   `src/workflows/launch-workflow.test.ts`) driving the script as a child process. Concrete need:
   `vitest.config.ts` includes only `src/**/*.test.ts`, so a `scripts/*.test.mjs` file would never run under
   `pnpm test`, and widening the fence to `vitest.config.ts`/`package.json` is worse than following the existing
   precedent (`src/cli/resolver.integration.test.ts` tests `scripts/run-forge-cli.mjs` exactly this way).
   Override available: add `scripts/launch-workflow.test.mjs` + `vitest.config.ts` to `allowed_paths` instead.
2. **Gate probe shape (engineer's design freedom within AC 2-3).** Recommended: one bridge call returning the
   observed process cwd (non-git, hook-safe); comparison handles Windows separators/case. If the engineer finds
   the bridge probe unreliable, halt-and-report rather than weakening the gate.

## Implementation sequencing recommendation

One governed `/forge-run-ticket` self-run after this contract lands: RED gate protocol test → additive gate →
RED launcher tests → launcher → docs (README + command pointer) → GREEN → engineer → verifiers → PM → stop at the
commit gate. Post-merge: `pnpm install-commands` + `verify-install` (the command file is installed and gains the
pointer), then the human-approved operability confirmation run via the new launcher. The Fable 5 charter-precision
contract (PM commit-gate semantics + grounded-claim clause) is the next unit after this one, per PM sequencing.
