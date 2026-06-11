# Epic — Run ForgeGate workflows from a Forge-owned OS-temp launch cwd

## Why

The Claude Code harness writes per-invocation `TEMP*_out/_err` capture scratch into the **subagent process cwd**,
which is fixed at the **Claude launch cwd** for the whole session. When a workflow run is launched from a session
that was started inside a repo working tree, that scratch lands in the repo. The charter-level rule shipped in
PR #51 is live-proven **necessary but insufficient** (a clean workflow run still left scratch in the session repo
with the refreshed charter installed): the producer is the harness Bash-tool capture wrapper, below the charter
layer and below workflow command-shape control. A spike established that the session cwd is immutable in-session
and that subagents anchor to the launch cwd, so the **only lever is where the `claude` process itself is started**.

The out-of-session proof (2026-06-09; smoke run `wf_edc2bed8-4ec`, full run `wf_d9d91c55-0c4`) settled it:
launching from an OS-temp scratch directory, the full governed loop reached the guard + agent-schema bridge calls
and `TEMP*` scratch materialized **nowhere** — ForgeGate repo, target clone, and launch cwd all stayed clean.
Classification: **PREVENTION_CONFIRMED**. No Core execute-capture redesign is needed.

## What

Convert the proven one-off proof procedure into ForgeGate's **permanent, enforceable prevention layer**
(PM-ratified shape): a small launcher script (`scripts/launch-workflow.mjs`) that creates a Forge-owned OS-temp
scratch cwd, hands the workflow absolute paths plus the scratch-cwd expectation, captures launch evidence and
pre/post `TEMP*` scans, and cleans up only its own scratch; a **strict workflow-side fail-closed launch-cwd gate**
in `forge-run-ticket.workflow.js` that verifies the observed launch cwd before checkpoint, lock acquire,
active-ticket emission, or any mutation; and the documented operator procedure (README + a pointer in the
command). Cleanup is hygiene — **the prevention claim rests on launch-cwd placement, never on a sweep**.

## Scope discipline

This epic changes how workflow runs are **launched and evidenced**. It does NOT redesign Core execute/capture,
does NOT loosen the permissions hook, does NOT alter workflow correctness beyond the launch procedure/wrapper
surface, and does NOT touch the lock, ledger, guard, run-report, or schema modules. The PR #51 charter rule stays
intact as documented L2 intent.

## Tickets

- **T01** — Run ForgeGate workflows from a Forge-owned OS-temp launch cwd.

## Claude Code Substrate Review

- **Workflows (execution):** the Workflow tool anchors every subagent's Bash process cwd to the Claude **launch**
  cwd; there is no per-dispatch cwd parameter and an in-command `cd` does not relocate harness capture scratch.
  This epic exploits that substrate fact instead of fighting it: place the launch cwd where scratch is harmless.
- **Hooks (permissions):** a session launched from an OS-temp scratch directory does not load ForgeGate's
  project-local PreToolUse hook. The procedure therefore hard-restricts such sessions to launch-and-prove actions
  (no outward git/gh, no source edits) — the same restriction set the proof runbook used. No hook change, no hook
  loosening.
- **Forge Core (governance):** unchanged. The workflow keeps reaching Core through the typed `forge-core-runner`
  bridge; `repo snapshot`, the epic lock, guard, and the run-report already provide the deterministic facts and
  evidence this procedure records.
- **Agents/charters:** unchanged. PR #51's scratch charter rule remains as L2 documented intent; this epic adds
  the substrate-level prevention the charter cannot provide.
- **Skills ≠ safety:** documentation alone is the same L2 layer PR #51 proved insufficient — which is why the
  PM ratified the strict workflow-side fail-closed gate as part of this epic: the launch contract is
  machine-checked, not operator discipline.
