# `/forge-run-ticket` — Design Note (for review, not yet built)

**Status:** Draft for Dan's approval. No implementation until approved.
**Scope:** Package the *proven* one-ticket flow into a repeatable orchestrator. Extremely conservative v1:
orchestrate ONE ticket and **stop at the commit gate** with handoff materials. No scope expansion.

Proven flow (run #2): validate → run --dry-run → generate packets → branch → engineer → validate output →
verify → semantic → validate → scope → validate → PM → validate → commit gate.

## v1 hard constraints (carried verbatim)
One ticket only · interactive Claude Code orchestration · no headless · no auto-commit/push/PR/merge ·
no status write-back · no journal write · no manifest/ticket/governance edits · engineer edits only
`allowed_paths` · every packet pins absolute `repo_root` · all agents operate inside `repo_root`
(evidence outside it is invalid) · every agent output must pass `parseAgentOutput` · malformed output →
escalate · failed verify → correct/escalate · scope violation → correct/escalate · correction cap = 3 ·
stop at commit gate with handoff materials.

---

## 1. Command surface & arguments
`/forge-run-ticket <epic-path>` — a Claude Code command whose body drives the orchestration *procedure*
in the interactive session (it is necessarily thicker than the thin read-only wrappers, because only the
session can dispatch subagents). v1 runs the **next ready ticket** (from `forge run --dry-run`); an explicit
`--ticket <id>` is deferred. Deterministic steps shell out to Forge Core via `scripts/run-forge-cli.mjs`
(and a small new packet/parse entrypoint); dispatch uses the Task tool; git via Bash.

## 2. Preflight checks (all must hold, else refuse)
1. `forge validate <epic>` clean. 2. `forge run --dry-run` selects a ticket (not BLOCKED). 3. Working tree
clean (`DIRTY_TREE` halt — ask the human). 4. No active lock (`LOCK_EXISTS` halt — show recovery). Refusal
is read-only.

## 3. Branch behavior
Create/switch `forge/<epic-id>/<ticket-id>-<slug>` off `manifest.integration_base` (default `main`), from a
clean tree. One ticket per branch; never work on `main`. Record a checkpoint `{base, HEAD, ticket, timestamp}`
in the run-report. No commit is made by the run.

## 4. Dispatch strategy (registered agent vs injected charter — deterministic)
A **dispatch adapter** resolves how to run each role:
- **Preferred:** the registered `forge-<role>` subagent type, if the runtime exposes it.
- **Fallback (deterministic):** a `general-purpose` agent whose prompt is built from the **tracked charter file**
  `agents/forge-<role>.md` (its body, read verbatim — never an improvised prompt) **plus** the generated packet.
The adapter picks preferred-if-available, else fallback; both paths receive the identical packet. (This harness
only supports the fallback today — §portability.)

## 5. Packet generation & cwd discipline
`generateRunPackets(epicPath, repo_root)` builds engineer/semantic/scope/PM packets + active-run metadata.
Every packet pins absolute `repo_root` = `required_cwd` and the four cwd-discipline statements; agents `cd`
there first and must not inspect sibling/default dirs. Wrong-cwd evidence is invalid. (This is the run-#1 fix.)

## 6. Verify command execution
After the engineer returns, the **orchestrator independently** runs the ticket's `verify_commands` inside
`repo_root` (it does not trust the engineer's `commands_run` claim) and records real pass/fail. A failure is a
`VERIFY_COMMAND_FAILED` → correction loop.

## 7. Agent output parsing
Every agent's raw output → `parseAgentOutput(role, raw)`. On `!ok` → `AGENT_OUTPUT_INVALID` → escalate. The
orchestrator acts **only** on validated structure; it never infers or repairs, and rejects prose-only output.

## 8. Correction loop
PM `CORRECT` → re-dispatch the engineer with the PM's bounded `instructions` filled into the engineer packet's
`prior_corrections` → re-run verify → re-dispatch both verifiers → re-dispatch PM. Cap = **3** cycles; the 4th
need → `CORRECTION_CAP_REACHED` → escalate with a recovery brief. PM may not `PASS` over a verifier `REJECT`
without a recorded override + human escalation.

## 9. PM PASS → commit-gate handoff
On `PASS` + verify green + scope clean, the orchestrator **prepares and stops** (no commit): changed-file
summary, verification summary, PM decision, **proposed** status transition (`Tnn pending → ready_for_pr`, not
applied), suggested commit message, exact suggested `git add`/`git commit` command, recovery brief. The human
inspects and decides.

## 10. Cleanup / discard for failed runs
On escalate / cap-reached / unresolved scope violation: produce a **recovery brief** (files changed +
checkpoint to revert to); **leave the branch + working changes for human inspection** (do not auto-discard);
offer rollback (`git restore`/`clean` to checkpoint) only with explicit human OK. Never leave the repo
ambiguous. (Matches how we handled the sandbox runs — human decides discard.)

## 11. Exact non-mutating guarantees
The run makes **no** commit/push/PR/merge; writes **no** tracked files except the engineer's edits under
`allowed_paths` (left uncommitted); writes **no** journal/manifest/ticket/governance/status files. The only
state it creates is: a branch ref, the engineer's uncommitted `allowed_paths` edits, and gitignored `.forge/`
runtime artifacts (§12).

## 12. Artifacts written (proposed — confirm)
Only under gitignored `.forge/` (nothing tracked, nothing committed):
- `.forge/active-ticket.json` — the `forge-active-ticket/v1` contract (absolute `repo_root`, ticket, branch,
  allowed/forbidden/protected paths), emitted deterministically by `forge active-ticket` and consumed by
  `forge guard paths` at the scope-check step (and callable by future hooks).
- `.forge/lock.json` — concurrency guard (stale detection by pid/age).
- `.forge/run-report.json` — the full transcript: packets used, each agent's validated output, verify results,
  PM decision, commit-gate materials, checkpoint.
If you want v1 to write **zero** files (session-only state), say so and I'll keep it all in-session; my
recommendation is the gitignored `.forge/` set, since it's runtime-only and feeds future hooks/resume.

**Run-report ownership clarification (Core-owned runtime evidence only).** As of the
`forge-run-report/v1` promotion, `$EPIC/.forge/run-report.json` is a Core-owned, Zod-validated artifact
written exclusively by `forge run-report write` (`src/run-report/`). It is **runtime evidence only**:
not status write-back, not journal automation, not run identity (no `run_id`/`attempt_id`), and
explicitly not commit/push/PR/merge automation. The v1 safety thesis is enforced by the schema —
every `safety.*` boolean is `z.literal(false)`, so any future caller attempting to record a commit,
push, PR open, merge, status write-back, or journal write is rejected by the type at the boundary; a
deliberate `forge-run-report/v2` schema bump is required to unlock any of those. The orchestrator
(§10/§11) no longer hand-authors the JSON; it only supplies runtime metadata (`--result`, checkpoint
SHAs, guard outcome, optional commit-gate materials, optional `--note` narrative) and lets Core
assemble, validate, and write a deterministic, byte-identical artifact per inputs.

---

## Build order (after this note is approved)
1. This design note. 2. **Dispatch adapter** (registered-or-injected-charter, deterministic; unit-tested for
charter-text loading + selection). 3. `/forge-run-ticket` wrapper/orchestration procedure. 4. One sandbox run
via the packaged flow. 5. Only then consider journal/status/local-commit options.

**Not in this increment:** local commit, status write-back, journal append, hooks, multi-ticket loop.

## Resolved decisions (Dan)

**Artifacts — gitignored `.forge/` set only.** v1 may write `.forge/active-ticket.json`, `.forge/lock.json`,
`.forge/run-report.json` — operational state, never tracked, never committed. No tracked file is written
except the engineer's `allowed_paths` edits. Never write `manifest.yaml`, ticket front-matter, `JOURNAL.md`,
`DECISIONS.md`, or governance docs. **If `.forge/` is not gitignored, stop and escalate before writing.**

**Lock — include `.forge/lock.json`.** Preflight: create it if absent (before branch/dispatch); if present →
`LOCK_EXISTS`, stop, never silently overwrite. Contents: `{session_id, command, epic_path, ticket, branch,
repo_root, pid, started_at}`. Stale detection via `pid` + `started_at`: report stale + show an explicit
recovery command, but never auto-delete silently. Release the lock on normal commit-gate stop and on
controlled ESCALATE (**after** writing `run-report.json`); on crash the lock remains and requires explicit
recovery. `LOCK_EXISTS` ⇒ no branch creation, no dispatch, no mutation.

**Failed run (ESCALATE / cap-reached / unresolved scope violation / invalid output / uncorrectable verify) —
preserve evidence; human decides.** The orchestrator: stops; writes `run-report.json`; releases the lock;
produces a **recovery brief** (failure code, PM/verifier decision, changed files, checkpoint HEAD, branch,
commands run, verify results, scope findings, **suggested** cleanup/rollback commands); **leaves the branch +
working tree intact**; asks the human. Recovery commands are *shown, not executed*. The only thing auto-cleaned
is the gitignored lock (released after the report). Implementation/test files, branch, and diffs stay for the
human. Rule: **failed live run preserves evidence; human decides rollback/discard.**
