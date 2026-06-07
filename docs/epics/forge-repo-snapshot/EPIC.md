# Epic — Core-owned repo snapshot: hook-compatible read-only git facts for the workflow runner

## Why

The first live run of the workflow-backed runner (finding:
[`docs/workflow-live-proof-finding.md`](../../workflow-live-proof-finding.md)) failed **before reaching its own
`forge lock acquire`**, at the preflight clean-tree check. Root cause: the workflow reaches read-only git as
`git -C "${repoRoot}" <args>` through the `forge-core-runner` bridge, and the live four-class permissions hook
**denies the `git -C` form** (the runner L3 backstop permits only narrower read-only git shapes). So the workflow
cannot run end-to-end under the live hook — its serialization (the shipped lock wiring, PR #40) is correct by
source-test but **not live-reachable**.

The ratified fix is **not** to loosen the hook. The world-class design is: **the workflow asks Forge Core for repo
facts, and Core owns the safe git invocation.** Core already does exactly this for `guard paths` — it spawns git
with `execFileSync("git", ["-C", repoRoot, …])` (`src/guard/git.ts`), a **node child-process call, not a Bash tool
call**, so the PreToolUse hook never sees it. A new Core command exposes the read-only repo facts the workflow
needs the same way; the workflow then calls `forge repo snapshot …` (an allowed `node`/`forge` command class
through the bridge) instead of raw `git -C`.

## Goal

Add a single Core-owned `forge repo snapshot --repo-root <path> [--base <sha>]` command that returns the read-only
repo facts the workflow runner needs, computed via Core's internal (hook-free) git invocation; then rewire the
workflow runner to obtain all its repo facts from `forge repo snapshot` and **stop issuing raw `git`/`git -C`**.
This makes the workflow live-reachable under the permissions hook without weakening it, unblocking a re-run of the
A+B live proof.

## Sprints

- `sprint-01-repo-snapshot` — one ticket: add `forge repo snapshot` (Core, injected-seam, tested) and rewire the
  workflow runner to use it, proven by a non-tautological workflow protocol test (raw `git -C` gone; `repo
  snapshot` present) with the existing lock-wiring tests staying green.

## Out of scope (this epic)

- **Loosening the permissions hook** (e.g. allowing `git -C` for the runner). Explicitly rejected as the fix.
- Editing the lock primitive/CLI, the ledger modules, the schema, the run-report modules, the guard, any agent
  charter, or any command.
- The secondary **scratch-file isolation** finding (the `forge-core-runner` writes temp output in the session cwd
  rather than the target `repoRoot`) — documented as a related finding, tracked separately, not fixed here unless
  strictly required to make `repo snapshot` work.
- Stale-recovery UX; evidence / `run_id` artifact ownership; worktree / shared-state architecture; status
  write-back; journal write.
- Executing the A+B live re-proof (a separate, human-gated step after this lands).

## Carried-forward decisions (ratified)

1. The **epic lock remains the primary cross-run serialization guarantee**; this epic only changes *how the
   workflow reads repo facts*, not the lock semantics.
2. The fix is **Core-owned repo facts**, not a hook change. The workflow touches git **only** through Core.
3. A **single structured `forge repo snapshot`** command (not discrete per-fact subcommands) unless discovery in
   the ticket proves the single command adds unnecessary complexity.
4. Scratch-file isolation is a **separate** follow-up.
5. After this lands and is implemented, the **A+B live proof is re-run** (separate governed step) to confirm the
   workflow path is genuinely live-proven.
