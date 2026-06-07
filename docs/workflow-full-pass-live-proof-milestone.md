# Milestone — workflow runner full-PASS live proof (2026-06-07)

> **Both of ForgeGate's active execution paths are now live-proven to PASS end-to-end under the live permissions
> hook, serialized through the same atomic, owner-checked epic lock.** This records the milestone; it is not a
> contract. The full machine evidence is preserved (gitignored) at
> `.forge/proof-evidence/workflow-live-proof/evidence-rerun2.md`.

## Status

- **Command orchestrator (`commands/forge-run-ticket.md`): live-proven to PASS.** (Exercised on every governed
  self-run since the lock wiring landed, incl. the runs that shipped PRs #38–#48.)
- **Workflow runner (`workflows/forge-run-ticket.workflow.js`): live-proven to PASS.** (This milestone — first
  full happy-path PASS through the Workflow tool under the live hook, against an external/clone `repoRoot`.)
- **Both execution paths serialize through the same atomic, owner-checked epic lock** (`forge lock`, `forge-lock/v1`).

## How we got here (the cross-run concurrency arc — complete and demonstrated)

Core lock primitive (PR #34) → `forge lock` CLI + `defaultLockIo` (PR #36) → command-orchestrator wiring (PR #38)
→ workflow-runner wiring (PR #40) → `forge repo snapshot` hook-free repo facts (PR #45) → Core-owned
`active-ticket --out` + Core-fed scope diff (PR #48) → **A+B live proof PASS** (this milestone).

The arc moved from *designed* → *tested* → *reviewed* → **live-proven**.

## The live proof (rerun #2, after PR #48, clone @ `d45d523`)

Isolation: disposable sibling clone `D:/Projects/forge-workflow-live-proof`, refreshed to `main @ d45d523`,
clean. Target: the sterile `sandbox-epic` T01. The live repo was never the target.

### Sub-proof A — contention / fail-closed — PASS
A foreign lock was held (`run_id = proof-A-foreign-holder`); the workflow was invoked with a different `runId`.
It cleared the `repo snapshot` clean-tree preflight, **reached `forge lock acquire`**, and the foreign lock
blocked it: `{ result: ESCALATE, code: PREFLIGHT_LOCK_HELD, outward_action_taken: false }` — **before any
mutation** (no active-ticket emission, no engineer edits, no branch). The foreign lock was not overwritten and
was released owner-checked; `lock.json` removed.

### Sub-proof B — full happy-path — PASS
A clean run produced `{ result: PASS, pm_verdict: PASS, decision_id: D-001, ledger_append_ok: true,
lock_release: { ok: true }, outward_action_taken: false }`. Verified from the clone's on-disk artifacts:

- `active-ticket.json` is valid JSON and its `repo_root` (`D:\Projects\forge-workflow-live-proof`, Windows
  backslashes) round-trips intact — the byte-exact Core `--out` write, no agent-prose corruption.
- `guard { result: OK, exit: 0 }`; scope verifier **APPROVE** from the Core-fed `changed_files`; semantic
  verifier **APPROVE**; PM **PASS** (`decision_id: D-001`, cross-checked); ledger appended `D-001`; run-report
  `forge-run-report/v1` written with `agent_output_source.* = workflow_core_runner`.
- The epic lock was held across the loop and **released owner-checked** at the terminal outcome; `lock.json`
  gone afterward.
- **`safety.*` all false** (`committed`, `pushed`, `pr_opened`, `merged`, `status_write_back`, `journal_written`)
  and **no outward action** occurred. The clone's engineer work (`src/sandbox/add.ts` + test) was left
  uncommitted in-fence; the real (session) repo ended clean.

## Remaining follow-up

- **Scratch-file isolation** — the `forge-core-runner` writes its scratch output (`TEMPfcr_*`) to the session
  cwd rather than the target `repoRoot`. Observed in both live reruns; harmless (removed, real repo clean) but
  real. This is the next recommended implementation unit.

Deferred behind it, in order: stale-lock recovery UX → evidence / `run_id` artifact ownership →
worktree / shared-state architecture.
