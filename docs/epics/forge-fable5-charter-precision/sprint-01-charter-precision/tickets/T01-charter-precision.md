---
schema_version: 1
id: T01
title: Clarify PM commit-gate semantics and add grounded-claim clause to role charters
kind: green
risk: medium
change_class: feature
blast_radius: cross_module
status: pending
depends_on: []
blocks: []
allowed_paths:
  - agents/forge-engineer.md
  - agents/forge-pm.md
  - agents/forge-semantic-verifier.md
  - agents/forge-scope-verifier.md
  - agents/forge-core-runner.md
  - src/agents/charter-output-format.test.ts
  - docs/epics/forge-fable5-charter-precision/**
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - .claude/**
  - commands/**
  - workflows/**
  - scripts/**
  - "src/agents/parse-output*"
  - "src/agents/schemas*"
  - "src/agents/load-*"
  - "src/agents/index*"
  - src/orchestrator/**
  - src/workflows/**
  - src/cli/**
  - src/cli.ts
  - src/index.ts
  - src/repo/**
  - src/guard/**
  - src/run-report/**
  - src/schema/**
  - src/validate/**
  - src/importer/**
  - src/install/**
  - src/fs/**
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

# T01 — Clarify PM commit-gate semantics and add grounded-claim clause to role charters

## Scope

Two precise, **additive** charter updates plus the exact-token lock tests that keep them from drifting:

1. **PM commit-gate semantics** (`agents/forge-pm.md`): state explicitly what every other layer of ForgeGate
   already encodes — for a human-gated ticket, the designed terminal handoff state at the commit gate, **before**
   human approval, is `committed: false`, `ahead_of_base: 0`, `outward_action_taken: false`,
   `human_gate_required: true`. That state is **PASS-compatible**; the PM must not demand a commit before PASS.
2. **Grounded-claim clause** (all five charters: engineer, pm, semantic-verifier, scope-verifier, core-runner):
   a concise, role-adapted rule — before reporting progress or a verdict, **audit each material claim against a
   tool result from this session**.

Charters are installed bytes: the implementation merge must be followed by `pnpm install-commands` and a green
`node dist/cli.js verify-install`.

## Out of scope (halt-and-report if any becomes necessary)

- Any change outside the five charters, the charter-lock test file, and this epic's docs.
- Any weakening of an existing charter rule — every change here is additive precision.
- Workflow, command, Core, CLI, hook, lock, guard, ledger, schema, repo, or run-report changes.
- The launch-cwd implementation (separate, already-landed contract `forge-workflow-scratch-launch-cwd`).
- Status write-back; journal write; any outward git/gh action.

## Discovery findings (inspected and live-proven, not assumed)

1. **The drift, observed live (run `wf_d9d91c55-0c4`, 2026-06-09):** with engineer parse ok, both verifiers
   APPROVE, `pnpm test` green, `guard {OK, exit 0}`, changed files in fence, and `safety.*` all false, the Fable 5
   PM returned `CORRECT` (decision `D-001`) with the recorded rationale that `final_branch_status` showed
   `committed: false` / `ahead_of_base: 0` and "the pr gate requires committed work; an empty branch cannot
   satisfy the gate" — instructing the engineer to stage and commit. The identical end state received PM `PASS`
   under the prior model (the #49 A+B proof, run `wf_80cbaac8-810`).
2. **Why the drift is wrong:** ForgeGate's thesis is human-gated outward action. Both orchestrators stop at the
   commit gate; the human commits after explicit approval; the run-report schema types `safety.committed` as
   literal `false` (a PASS report cannot even be written for a committed state). An agent committing would itself
   be a safety violation.
3. **The charter gap (inspected):** `agents/forge-pm.md` "How you decide" (lines 19-24) defines PASS purely as
   verifiers + verify_commands + halt-triggers + acceptance criteria — silent on commit state. Nothing tells the
   PM that uncommitted-at-the-gate is by design, so the model filled the silence by inference. The fix is the
   charter saying it explicitly (L2 is the right layer: this is judgment miscalibration, not a missing hard
   guarantee — lock/guard/schema already prevent unsafe consequences; the drift costs runs, not safety).
4. **Grounded-claim provenance:** Anthropic's Fable 5 guidance ships a tested grounding instruction (audit each
   claim against a tool result from this session) that nearly eliminated fabricated status reports in their
   testing — the officially validated form of ForgeGate's existing scattered rules ("never invent", "never
   fabricate", verbatim-output rules). Inspected: engineer/pm/semantic/core-runner each carry *some* variant;
   **`agents/forge-scope-verifier.md` carries none** — the clause is additive there and unifying elsewhere.
5. **Charter-lock test home + pattern (inspected):** `src/agents/charter-output-format.test.ts` reads the charter
   markdown and asserts exact lowercase tokens (`toContain`), with describe blocks per concern — including the
   #51 scratch-capture block whose review set the standard: **lock the exact load-bearing language, never a broad
   token** (the broad `clean` token also matched "no git clean" and protected nothing).

## Required behavior

**PM charter (`agents/forge-pm.md`) — commit-gate semantics, added to "How you decide" / "You MUST NOT":**
- For a human-gated effective gate (pr/merge/phase/manual), the expected terminal handoff state at the commit
  gate before human approval is: `committed: false`, `ahead_of_base: 0`, `outward_action_taken: false`,
  `human_gate_required: true`.
- That state is **PASS-compatible** when all PASS conditions hold: engineer parse ok, semantic verifier APPROVE,
  scope verifier APPROVE, guard OK, the ticket's `verify_commands` green, changed files inside `allowed_paths`,
  `safety.*` all false, and no halt-trigger outstanding.
- Distinguish **"ready for the human commit gate"** (expected; the orchestrator-confirmed facts show uncommitted
  in-fence work) from **"the work was not done"** (missing files, failing proof, REJECTed verdicts).
- The PM **must not demand a commit, push, or any outward action before PASS** — the human performs the outward
  commit after PM PASS and explicit approval.
- **Fail-closed preserved:** if an outward action actually occurred without recorded human approval (e.g.
  `committed: true`, pushed, merged, or any `safety.*` flag true), that is a halt — never PASS quietly. All
  existing MUST NOT rules (no silent verifier overrides, no weakening acceptance criteria, no invented facts)
  remain verbatim.

**Grounded-claim clause (all five charters):**
- One concise rule per charter, placed in each charter's existing honesty/anti-theater section (the
  scope-verifier charter gains its first such line). Role-adapted phrasing is allowed; the load-bearing tokens
  are exact and shared: **"audit"**, **"claim"**, **"tool result"**, **"this session"** — i.e., before reporting
  progress or a verdict, audit each material claim against a tool result from this session.

**Charter-lock tests (`src/agents/charter-output-format.test.ts`):**
- New describe block(s) pinning the PM gate-semantics language: at minimum the PASS-compatibility statement, the
  `ahead_of_base` expectation, the ready-vs-not-done distinction, and the never-demand-a-commit rule — exact
  phrases as landed, per-token assertions (no broad tokens).
- New assertions pinning the grounded-claim tokens in **each of the five** charter files (the existing test's
  `CHARTERS` list covers four; the core-runner is asserted in its own block — extend whichever structure keeps
  all five covered).
- All existing charter-lock assertions stay green and unmodified (additive test changes only).

## AI Instructions

- TDD: RED the new charter-lock assertions first (they fail against the current charters), then make the charter
  edits that turn them green. Keep every edit additive — do not reword existing rules while adding.
- Match each charter's existing voice and formatting; keep the clause concise (this is precision, not prose).
- Do not touch the YAML-output rules, the Core-pinned field rules, or the scratch-capture section beyond what the
  grounded-claim insertion requires (which is: nothing).
- `pnpm test` and `pnpm typecheck` green; scope guard clean.
- Run-report note must state the install-refresh obligation (installed charters changed).

## Acceptance Criteria

**PM commit-gate semantics:**
1. `agents/forge-pm.md` explicitly states that `committed: false` / `ahead_of_base: 0` at a human-gated commit
   gate is the **expected, PASS-compatible** handoff state when all PASS conditions hold.
2. The charter distinguishes "ready for the human commit gate" from "the work was not done", and states the PM
   must not demand a commit (or any outward action) before PASS — the human commits after PASS and explicit
   approval.
3. The charter still fails closed when an outward action occurred without approval: `committed: true`, pushed,
   merged, or any `safety.*` flag true is a halt, never a quiet PASS.
4. The charter still rejects missing proof, a failed verifier, guard failure, scope violations, and unsafe safety
   flags — all existing MUST NOT and anti-theater rules remain verbatim (additive change only).

**Grounded-claim clause:**
5. All five role charters (engineer, pm, semantic-verifier, scope-verifier, core-runner) contain the
   grounded-claim rule with the exact load-bearing tokens ("audit", "claim", "tool result", "this session"),
   role-adapted phrasing allowed.
6. No existing safety rule is weakened or reworded — verified by the verifiers against the diff and by the
   existing charter-lock tests staying green unmodified.

**Charter-lock tests:**
7. `src/agents/charter-output-format.test.ts` pins the new PM gate-semantics phrases and the grounded-claim
   tokens in all five charters with exact-token assertions (no broad tokens — the #51 standard); the new
   assertions fail against the pre-change charters (genuinely RED first).

**Lifecycle and boundaries:**
8. `pnpm test` and `pnpm typecheck` pass.
9. The run report states that `pnpm install-commands` is required post-merge (installed charters change) and that
   `verify-install` is expected stale at the commit gate until then.
10. `node dist/cli.js verify-install` passes after the post-merge install refresh.
11. No implementation-logic change outside the five charters + the charter-lock test + this epic's docs.
12. No workflow, command, Core, CLI, hook, lock, guard, ledger, schema, repo, run-report, package, or governance
    change; scope guard clean (only `allowed_paths` change).

## Verification

- RED→GREEN charter-lock evidence (the new exact-token assertions failing before the charter edits, passing
  after) plus full `pnpm test` / `pnpm typecheck`.
- Governed two-pass verifiers review the diff for additivity (nothing weakened) and token fidelity; PM judges.
- Post-merge (separate steps): `pnpm install-commands` → `node dist/cli.js verify-install` green → the next
  governed run exercises the corrected PM charter live.

## Known risk — the bootstrap drift (pre-declared)

The governed self-run implementing this ticket is judged by the **previously installed** PM charter (standing
bootstrap rule), so the very drift being fixed may fire during this run's own PM step. If the PM agent returns
`CORRECT` demanding a commit while the orchestrator-confirmed facts show the designed uncommitted gate state and
all other PASS conditions green, the orchestrator must **not** have the engineer attempt a commit (that would be
an outward-action violation); it should treat the verdict as the known, documented drift, halt the correction
loop, and surface it to the human PM with this ticket cited. The human PM may then direct the resolution
(precedent: the human gate already overrides procedural verdicts in both directions).

## Open decisions (for the PM)

1. **Exact lock-test token list.** The floor is fixed (PASS-compatibility statement, `ahead_of_base` expectation,
   ready-vs-not-done distinction, never-demand-a-commit, grounded-claim tokens ×5); the final verbatim phrases are
   chosen at implementation when the charter sentences land, and reviewed at the focused PR review for the #51
   exact-token standard.
2. **Grounded-claim placement per charter.** Default: each charter's existing honesty/anti-theater section
   (engineer "You MUST NOT", pm "Anti-theater rules", semantic-verifier evidence rules, core-runner fidelity
   contract); the scope-verifier (which has none today) gains a single line in its verdict-discipline section.
   Engineer's judgment within these defaults; flag any structural deviation in `deviations`.

## Implementation sequencing recommendation

One governed `/forge-run-ticket` self-run after this contract lands: RED the charter-lock assertions → additive
charter edits → GREEN → engineer → verifiers → PM (bootstrap-drift note above applies) → stop at the commit gate.
Post-merge: `pnpm install-commands` + `verify-install` green, then **the launch-cwd implementation self-run
(`forge-workflow-scratch-launch-cwd` T01) proceeds with the corrected PM judge** — the reason this ticket runs
first.
