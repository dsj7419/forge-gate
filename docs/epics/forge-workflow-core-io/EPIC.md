# Epic — Core-owned workflow artifact write + Core-fed scope diff for full workflow PASS

## Why

The workflow live-proof rerun (finding: [`docs/workflow-live-proof-rerun-finding.md`](../../workflow-live-proof-rerun-finding.md))
proved the workflow runner's **lock lifecycle** live (acquire → hold → owner-checked release; the `git -C`
blocker from PR #45 is fixed). But a full happy-path **PASS** via the workflow against an external / clone
`repoRoot` is still blocked by **two second-order issues**, both instances of one anti-pattern: *the workflow and
its role agents depend on raw shell/git or a prose agent-write to handle target-repo state.*

1. **Active-ticket write fidelity.** The workflow writes `active-ticket.json` by handing JSON bytes to the
   `forge-core-runner` agent ("write these exact bytes"). On Windows the agent round-trips `\\` → `\`, so the
   on-disk `active-ticket.json` is **invalid JSON** (`repo_root: "D:\Projects\…"`) → `forge guard paths` returns
   `ACTIVE_TICKET_INVALID` → `guardOk: false`.
2. **Scope-verifier target-repo inspection.** The scope-verifier subagent's Bash cwd is the **session** repo, not
   the clone/external target; the L3 hook denies `git -C` / `cd && git`, and bare git inspects the wrong repo — so
   the verifier fails closed → REJECT even though the changed files are in-fence.

The guiding rule: **the workflow and role agents must not depend on raw shell/git to inspect or write target-repo
state; Core owns structured artifacts and repo facts.** Neither fix loosens the permissions hook.

## Goal

Make the workflow reach full happy-path PASS under the live hook (for an external / clone `repoRoot`) by:

1. **Core writes the active-ticket directly** — add `forge active-ticket … --out <path>` so Core emits the
   `forge-active-ticket/v1` JSON to a file **byte-exact** (no agent prose byte-write), and the workflow uses it.
   This fixes the Windows-path corruption and, with it, `forge guard paths`'s `guardOk`.
2. **The workflow feeds the scope verifier Core-owned changed-file facts** — the workflow already obtains the
   target-repo changed files from `forge repo snapshot` (PR #45); inject that authoritative list into the
   scope-verifier's dispatch so it scope-checks from Core facts instead of shelling git. The scope-verifier
   charter already accepts a provided diff ("`git diff --name-status` for the change, **or the means to compute
   it**"), so **no charter edit is required**.

Together these let the workflow reach PASS; the A+B live proof is re-run after implementation to confirm.

## Sprints

- `sprint-01-core-io` — the fix (one ticket recommended; see the ticket's open decision on one-vs-split).

## Out of scope (this epic)

- Loosening the permissions hook (`.claude/**`). Explicitly rejected.
- Stale-recovery UX; evidence / `run_id` artifact-ownership *broadly*; worktree / shared-state architecture;
  scratch-file isolation (kept separate unless strictly required); status write-back; journal write.
- Editing the lock primitive/CLI, ledger modules, schema, run-report modules, the guard, or `src/repo` (the
  `repo snapshot` is reused/invoked, not edited).
- Editing agent charters or commands unless discovery during implementation proves it strictly required (current
  discovery says it is **not** — the scope-verifier charter already accepts a provided diff).

## Carried-forward decisions (ratified)

1. Core owns structured-artifact writes and target-repo facts; the workflow/role agents do not shell raw git or
   prose-write load-bearing JSON for target-repo state.
2. No hook loosening.
3. The epic lock remains the primary cross-run serialization; this epic does not touch lock semantics.
4. After implementation + merge, **re-run the A+B live proof** to confirm full workflow PASS.
