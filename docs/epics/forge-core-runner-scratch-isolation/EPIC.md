# Epic — Scope forge-core-runner scratch capture away from the repo cwd

## Why

The workflow live-proof reruns (recorded in `docs/workflow-full-pass-live-proof-milestone.md`) reached a full
workflow PASS, but each run left transient `TEMP*_out.txt` / `TEMP*_err.txt` scratch files in the **session repo
cwd** that had to be cleaned up by hand. Discovery established the cause: the `forge-core-runner` charter requires
the agent to return **verbatim stdout/stderr**, but does **not** specify where any temporary capture may be
written — so the agent improvises stream-redirect scratch files in its Bash cwd (the harness session cwd), not the
target `repoRoot`.

This is a low-risk substrate-hygiene issue, not a failing safety gate. The right-sized first fix is a
**charter-scoped rule plus a charter-lock test**, with a post-merge live confirmation. It is explicitly **not** a
Core-owned deterministic-capture rewrite (that heavier escalation is deferred unless the problem recurs).

## What

- Amend the `forge-core-runner` charter to prohibit scratch/temp files in the cwd or any repository working tree,
  require any necessary transient capture to use the OS temp directory (namespaced by the available run/session
  id) with cleanup after readback, and prefer inline capture when sufficient — while preserving the existing
  verbatim-fidelity / no-synthesis output requirements.
- Lock the rule with a non-tautological charter test so it cannot silently regress.

## Scope discipline

L2/charter discipline fix, not hard substrate enforcement. This is the right-sized first fix for a low-risk
hygiene issue; if it recurs, the next escalation is a Core-owned deterministic capture bridge. No Core behavior
change; no workflow behavior change unless strictly needed.

## Tickets

- **T01** — Scope forge-core-runner scratch capture away from repo cwd.

## Claude Code Substrate Review

- **Agent charter (forge-core-runner)** = the behavioral lever (L2). The fix lives here.
- **Workflows** = execution; unchanged (the workflow already passes run/session ids the charter can reference).
- **Hooks** = unchanged; not loosened. The L3 read-only-git restriction is untouched.
- **Forge Core** = unchanged; `CoreRunnerResult` and `.forge/**` structured-evidence writes are not modified.
- **Tests** = a charter-lock test (`src/agents/charter-output-format.test.ts`) is the regression guard.
