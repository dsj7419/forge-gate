# Finding — workflow live-proof rerun: lock lifecycle proven; two new blockers to full PASS

> **Outcome:** the A+B live-proof rerun (after the `forge repo snapshot` fix, PR #45 `8061570`) **met its goal** —
> the workflow is now live-reachable under the permissions hook and the epic-lock lifecycle (acquire → hold across
> correction cycles → owner-checked release) is **proven live**. It did **not** reach a full happy-path PASS via
> the workflow: Sub-proof B correctly surfaced **two new second-order blockers** (active-ticket JSON write
> fidelity on Windows paths; role-agent inspection of an external/clone repoRoot under the hook). Neither touches
> the lock. This supersedes the pre-fix blocker in [`docs/workflow-live-proof-finding.md`](workflow-live-proof-finding.md).

## 1. Environment

- Clone: `D:/Projects/forge-workflow-live-proof`, refreshed to **`8061570`** (`git pull --ff-only`), `pnpm install`
  + `build` clean. The PR #45 `forge repo snapshot` fix is present (verified: `forge repo snapshot` returns facts
  in-clone).
- Target: `sandbox-epic` T01 ("Add a small pure `add()` helper with a test").

## 2. Sub-proof A — contention / fail-closed — **PASS**

- Foreign lock acquired via CLI (`forge-lock/v1`, `run_id=proof-A2-foreign-holder`).
- Workflow invoked (Run `wf_c5c184c7-19e`, a different `runId`) → **completed**:
  `{result: "ESCALATE", code: "PREFLIGHT_LOCK_HELD", evidence: {holder: {run_id: "proof-A2-foreign-holder", …}}, outward_action_taken: false}`.
- **The key result: `PREFLIGHT_LOCK_HELD`, not the old `git -C` failure.** The workflow cleared the
  snapshot-based clean-tree preflight, **reached `forge lock acquire`**, and the foreign lock blocked it **before
  any mutation** (no active-ticket emitted, no engineer edits, no branch).
- Foreign lock left intact (not overwritten), then released owner-checked (`{ok:true}`); `lock.json` gone.

## 3. Sub-proof B — happy-path lifecycle — **lock lifecycle PROVEN; PASS not reached**

- Workflow invoked (Run `wf_f7d1967a-d25`; 50 agents, ~984k tokens, ~26 min) → **completed**:
  `{result: "ESCALATE", code: "CORRECTION_CAP_REACHED", evidence: {attempt: 3, verifyResults: [{cmd: "pnpm test", result: "pass"}], guardOk: false, semanticApprove: true, scopeApprove: false, lock_release: {exit: 0, ok: true}}, outward_action_taken: false}`.
- **Lock lifecycle proven live:** the workflow reached `forge lock acquire`, **held** the lock across all 3
  correction cycles, and **released it owner-checked** on the terminal outcome (`lock_release: {ok:true}`).
  `outward_action_taken: false`; `lock.json` gone after release; real repo ended clean.
- **Engineer work was correct and in-fence:** `changed_files = src/sandbox/add.ts, src/sandbox/add.test.ts` (both
  within `src/sandbox/**`); `within_allowed_paths: true`; `pnpm test` green (653); **semantic verifier APPROVE**.
- **But the run escalated `CORRECTION_CAP_REACHED` instead of PASS** — `guardOk: false` and `scopeApprove: false`
  on every attempt, for the two blockers below. Three CORRECT cycles could not fix them (both are
  orchestrator/substrate concerns outside the engineer's `allowed_paths`).

## 4. Blockers (the next precise gaps to full PASS)

1. **Active-ticket JSON write fidelity / Windows-path escaping.** The workflow writes `active-ticket.json` by
   handing the JSON bytes to the `forge-core-runner` agent ("write these exact bytes"). On Windows the agent
   round-trips `\\` → `\`, so the on-disk `active-ticket.json` is **invalid JSON** (`repo_root: "D:\Projects\…"`;
   `JSON.parse` → "Bad escaped character at position 59"). `forge guard paths` then returns `ACTIVE_TICKET_INVALID`
   → `guardOk: false`.
2. **Role-agent inspection of an external / clone repoRoot.** The scope-verifier subagent's Bash cwd is the
   **session** repo (`D:/Projects/forge`), not the clone target. The L3 hook refuses `git -C` / `cd && git`, and
   bare `git status` inspects the wrong (real, clean) repo — so the verifier cannot obtain an authoritative diff
   and **fails closed → REJECT** (`scopeApprove: false`), even though the actual changed files are in-fence. (Its
   `scope-verifier-output.json` recommendation states exactly this.)

Both are partly proof-environment artifacts — the disposable clone forces `repoRoot ≠ session cwd`, and the path is
Windows-backslashed — and neither affects the command orchestrator (whose agents run in the session = target repo)
or a session-targeting workflow run. They are real for **external-repo workflow runs**.

## 5. Honest status

| Path | Status |
|---|---|
| **Command orchestrator** | **Live-proven to PASS** (reaches acquire, runs the loop to PASS, owner-checked release). |
| **Workflow runner — lock lifecycle** | **Live-proven** under the live hook (reach → acquire → hold → owner-checked release; `git -C` blocker fixed by PR #45). |
| **Workflow runner — full happy-path PASS** | **Not yet proven** for an external / clone repoRoot — blocked by §4(1) and §4(2). |

## 6. Recommended fix direction

- **Core-owned structured-artifact writes.** Have the workflow's `.forge/**` artifacts (active-ticket, facts,
  role captures) be written by **Core-owned file output** (e.g. `forge active-ticket --out <path>` writing the
  file directly, byte-exact) rather than natural-language "write these bytes" through a subagent. Fixes the
  Windows-path JSON corruption at the source.
- **Core-mediated target-repo facts for role verification.** Give the verifiers/role agents Core-owned repo
  facts/diff for the target `repoRoot` (the same principle as `forge repo snapshot`) — e.g. a Core-produced
  `name-status` diff artifact the scope verifier consumes — so they never depend on raw `git -C` / `cd && git`
  against a repo that isn't their Bash cwd.
- **Do not loosen the permissions hook** as the primary fix. The architectural rule holds: *the workflow and role
  agents must not depend on raw shell/git behavior to inspect or write target-repo state; Core owns structured
  artifacts and repo facts.*

**Next:** author a scoped fix contract (discover first; likely a combined "Core-owned workflow artifact IO +
Core-owned target-repo diff facts for role verification," only combined if the design stays tight), implement
under the governed loop, then **re-run A+B** to confirm full workflow PASS. Stale-recovery UX, evidence/`run_id`
ownership, and worktree/shared-state remain deferred behind that.

> Full machine evidence is preserved (gitignored) at `.forge/proof-evidence/workflow-live-proof/evidence-rerun.md`.
