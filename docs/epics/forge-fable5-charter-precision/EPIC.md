# Epic — Clarify PM commit-gate semantics and add grounded-claim clause to role charters

## Why

The first full ForgeGate workflow run under Fable 5 (run `wf_d9d91c55-0c4`, 2026-06-09, the scratch-launch proof)
surfaced a **PM-judgment drift**: with everything green (both verifiers APPROVE, tests pass, guard OK, scope
in-fence, `safety.*` all false), the PM agent returned `CORRECT` because `final_branch_status` showed
`committed: false` / `ahead_of_base: 0` — and instructed the engineer to commit. That misreads the product
thesis: **uncommitted-at-the-commit-gate is ForgeGate's designed terminal state** for a human-gated ticket. The
human performs the outward commit after the governed run stops; the run-report types `safety.committed` as
literal `false`. The identical end state received PM `PASS` under the prior model (the #49 A+B proof). The PM
charter (`agents/forge-pm.md`) is the one layer that never said this explicitly — its PASS conditions are silent
on commit state, so the model filled the gap by inference.

Separately, Anthropic's Fable 5 guidance ships an officially tested grounding instruction — *audit each claim
against a tool result from this session* — which is the validated form of the anti-fabrication rules ForgeGate
already enforces by hand (the B1 fabricated-output lineage). Today that rule appears unevenly across the five
charters; the scope-verifier charter carries no explicit version of it at all (inspected).

## What

Two precise, additive charter updates plus the tests that lock them:

1. **PM commit-gate semantics** (`agents/forge-pm.md`): for a human-gated ticket, `committed: false` /
   `ahead_of_base: 0` / `outward_action_taken: false` at the commit gate is the expected, PASS-compatible handoff
   state when all PASS conditions hold; "ready for the human commit gate" is distinguished from "work not done";
   the PM must not demand a commit before PASS; fail-closed behavior for actual outward actions is preserved.
2. **Grounded-claim clause** (all five role charters): a concise, role-adapted rule with exact load-bearing
   tokens — audit each material claim against a tool result from this session before reporting.

Both are pinned by exact-token charter-lock tests in `src/agents/charter-output-format.test.ts` (the #51 lesson:
lock the precise load-bearing language, never a broad token).

## Scope discipline

Charters and their lock tests only. No workflow, Core, CLI, hook, lock, guard, ledger, schema, repo, run-report,
command, package, or governance change. The charters are **installed bytes**: implementation must be followed by
`pnpm install-commands` + `node dist/cli.js verify-install` post-merge (and `verify-install` is expected to read
the charters as out-of-date at the commit gate before that refresh — the standing bootstrap rule).

## Tickets

- **T01** — Clarify PM commit-gate semantics and add grounded-claim clause to role charters.

## Claude Code Substrate Review

- **Agents/charters (L2 role calibration):** this is exactly the layer where model-behavior drift is corrected —
  the charter says explicitly what the prior model inferred correctly and Fable 5 did not. L2 is the right layer
  here because the failure was a *judgment miscalibration*, not a capability the agent lacks; the hard guarantees
  (lock, guard, schema-validated output, `safety.*` literal-false) already prevent any unsafe consequence — the
  drift costs runs, not safety.
- **Forge Core (governance):** unchanged — Core already encodes the thesis (`safety.committed` literal `false`;
  orchestrators stop at the gate). The charter is brought into line with Core, not the reverse.
- **Hooks:** untouched. **Workflows/commands:** untouched — both orchestrators consume the same charters.
- **Install lifecycle:** charters are installed into the Claude config home; editing them flips `verify-install`
  stale at the commit gate until the post-merge refresh (expected; the run report must say so).
- **Bootstrap rule:** the governed self-run implementing this ticket is judged by the *previously installed* PM
  charter — the very drift being fixed may fire during the run's own PM step. That risk is pre-declared in the
  ticket so the orchestrator and human PM recognize it instead of burning correction cycles.
