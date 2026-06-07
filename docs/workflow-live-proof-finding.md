# Finding — workflow live-proof blocked before lock acquire (`git -C` / L3 hook incompatibility)

> **Outcome:** the first live run of the workflow-backed runner (per
> [`docs/workflow-live-proof-discovery.md`](workflow-live-proof-discovery.md)) **did not confirm** the workflow's
> lock path. It surfaced a real substrate-compatibility gap **before** the workflow could be overclaimed as
> live-proven: the runner reaches read-only git as `git -C "${repoRoot}"`, which the live L3 permissions hook
> denies before execution, so the workflow fails at its preflight clean-tree check — upstream of its own
> `forge lock acquire`. This is the proof process working as designed.

## 1. Proof setup

- **Isolation:** disposable sibling clone at `D:/Projects/forge-workflow-live-proof` (the live repo was not the
  target).
- **Clone SHA:** `8e496c5` (`pnpm install` + `pnpm build` OK; `forge run sandbox-epic --dry-run` → READY → T01).
- **Target:** `sandbox-epic` T01 ("Add a small pure `add()` helper with a test").
- **Sub-proof A (foreign-lock contention):** acquired the clone's sandbox-epic lock via the CLI with a foreign
  `run_id` (`proof-A-foreign-holder`), then invoked the workflow (Workflow tool, Run `wf_ac6a5ff0-37d`) with a
  *different* `runId`/`sessionId` (`proof-A-workflow-run` / `proof-A-workflow-session`), expecting
  `PREFLIGHT_LOCK_HELD` before any mutation.

## 2. Result

- The workflow **failed before reaching `forge lock acquire`**, at the preflight clean-tree check:
  ```
  git command failed (exit 1): git -C D:/Projects/forge-workflow-live-proof status --porcelain
  Refused by the L3 PreToolUse permissions hook before execution and never ran:
  "forge runner agents perform no mutating/outward git/gh action; only read-only Class-1 git permitted (L3 backstop)".
  ```
  The intended command was a read-only `git status --porcelain`, but the **`git -C` form** was denied for the
  runner/role agent.
- **`PREFLIGHT_LOCK_HELD` was not reached** — the run died at its first git call, upstream of its own acquire.
- **Sub-proof B (full happy-path loop) was correctly skipped** — it would fail identically at the same
  clean-tree `git -C` call, before acquire. Running it would only waste a token-heavy loop.

## 3. Safety (the proof stayed clean)

- **No mutation:** no `active-ticket.json` was emitted; `src/sandbox/` retained only its original `.gitkeep`
  (no engineer edits); no branch was created. The run fail-closed even earlier than the lock gate.
- **Lock hygiene:** the foreign lock was released (owner-checked, `{ ok: true }`); `sandbox-epic/.forge/` is
  empty afterward — incidentally confirming the **CLI** lock lifecycle (record written on acquire, removed on
  owner-checked release).
- **Real repo:** returned **clean**. The proof left two stray temp files in the real repo
  (`TEMPfv_err.txt` / `TEMPfv_out.txt`) because the `forge-core-runner` subagent runs from the **session cwd
  (the real repo)**, not the target `repoRoot`, and wrote scratch there; they were removed and the tree
  re-confirmed clean. (See §5 secondary item.)

## 4. Root cause

- The workflow runner's read-only git helpers (`runGitText` / `runGitInt` in
  `workflows/forge-run-ticket.workflow.js`) construct **`git -C "${repoRoot}" <args>`** for: the clean-tree
  `status --porcelain`, `rev-parse HEAD` (checkpoint), `rev-parse --abbrev-ref HEAD` (branch), and
  `rev-list --count base..HEAD` (ahead-count). Each runs through the `forge-core-runner` bridge.
- The live **four-class permissions hook denies the `git -C` form**, and the runner **L3 backstop** permits only
  narrower read-only Class-1 git shapes. So every one of those calls is refused before execution.
- **Why it was previously hidden:** the `git -C` helpers predate the lock wiring (PR #40); the typed-bridge
  proof (PR #24 era) ran *before* the four-class hook shipped (PR #29), so the workflow had never met the live
  hook until now.
- **Why the command orchestrator is unaffected:** its main agent runs **bare git from the repo cwd** (no `-C`),
  adapting to the hook. The workflow is fully automated and runs the `git -C` string verbatim via the runner,
  with no adaptation.

## 5. Recommended fix direction

- **Route the workflow's read-only git through Forge Core**, not raw `git`/`git -C`. Core already spawns git
  *internally* for `guard paths` (a `node` child-process invocation, **not** a Bash tool call → not subject to
  the PreToolUse hook). The runner already calls `forge …` for everything else (lock, ledger, run-report), and
  `forge` is an allowed command class through the bridge. So the runner should ask Core for repo facts and let
  Core own the safe git invocation semantics.
- **Do not loosen the permissions hook** as the primary fix. Allowing `git -C` for the runner may be acceptable
  later if tightly proven, but the cleaner, world-class design is Core-owned repo facts — the workflow asks, Core
  answers.
- **Secondary item:** isolate the `forge-core-runner`'s scratch to the target `repoRoot` (it currently writes
  temp files in the session cwd). Track alongside, not necessarily in the same fix.

## 6. Status

| Path | Status |
|---|---|
| **Command orchestrator** | **Live-proven** serialized by the epic lock (real acquire/release exercised live). |
| **Workflow runner** | **Source-tested and reviewed, but not live-proven** under the current hook. |
| **Workflow live proof** | **Blocked before lock acquire** by the `git -C` / L3 hook incompatibility. |

**Next:** author a narrow fix contract (Core-owned read-only git helpers for the runner — e.g. a structured
`forge repo snapshot --repo-root <p> [--base <sha>]` and/or the discrete `status` / `rev-parse` / `ahead-count`
reads the workflow needs), land + implement it under the governed loop, then **re-run this exact A+B live proof**
to confirm the workflow path is genuinely live-proven. Stale-recovery UX, evidence/`run_id` ownership, and
worktree/shared-state architecture remain deferred behind that re-proof.

> Full machine evidence is preserved (gitignored) at `.forge/proof-evidence/workflow-live-proof/evidence.md`.
