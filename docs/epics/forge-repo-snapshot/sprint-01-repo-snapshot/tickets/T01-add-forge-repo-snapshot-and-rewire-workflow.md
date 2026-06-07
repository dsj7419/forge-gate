---
schema_version: 1
id: T01
title: Add forge repo snapshot and route the workflow runner's repo-fact reads through it
kind: green
risk: high
change_class: feature
blast_radius: app
status: pending
depends_on: []
blocks: []
allowed_paths:
  - src/repo/**
  - src/cli/run.ts
  - src/cli/run.test.ts
  - workflows/forge-run-ticket.workflow.js
  - src/workflows/forge-run-ticket-workflow-lock.test.ts
  - docs/epics/forge-repo-snapshot/**
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - .claude/**
  - agents/**
  - commands/**
  - .github/**
  - src/cli.ts
  - src/guard/**
  - src/orchestrator/lock.ts
  - src/orchestrator/lock-cli.ts
  - src/orchestrator/decisions-ledger.ts
  - src/orchestrator/ledger-cli.ts
  - "src/orchestrator/decision-id*"
  - "src/orchestrator/packets*"
  - "src/orchestrator/dispatch*"
  - "src/orchestrator/pm-dispatch*"
  - "src/orchestrator/index*"
  - src/run-report/**
  - src/schema/**
  - package.json
  - pnpm-lock.yaml
  - README.md
  - docs/governance/**
  - "**/.forge/**"
  - sandbox-epic/**
  - pilot-local/**
---

# T01 — Add forge repo snapshot and route the workflow runner's repo-fact reads through it

## Scope

Two coupled changes that together unblock the workflow runner under the live permissions hook:

1. **Add a Core-owned `forge repo snapshot` command** that returns the read-only repo facts the workflow needs,
   computed via Core's **internal, hook-free** git invocation (`execFileSync("git", ["-C", repoRoot, …])`, exactly
   as `src/guard/git.ts` already does — a node child-process call, not a Bash tool call, so the PreToolUse hook
   never intercepts it).
2. **Rewire `workflows/forge-run-ticket.workflow.js`** to obtain every read-only repo fact from `forge repo
   snapshot` through the existing `forge-core-runner` bridge, and **eliminate every raw `git`/`git -C` call** (the
   `runGitText` / `runGitInt` helpers and their seven call sites).

The fix is the Core abstraction layer, **not** a hook change. Do not loosen the permissions hook or edit
`src/guard/**` (it is imported/reused, never edited). If the work appears to need a hook change, a guard edit, or a
change to the lock/ledger/schema/run-report modules, **stop and report it in `deviations`** — that is a re-scope.

## Out of scope (halt-and-report if any becomes necessary)

- Loosening the permissions hook (`.claude/**`) or editing any agent charter or command.
- Editing the lock primitive/CLI, ledger modules, schema, run-report modules, or the guard.
- The secondary **scratch-file isolation** finding (the `forge-core-runner` writes temp output in the session cwd
  rather than the target `repoRoot`) — a separate follow-up; only address it here if it is strictly required to
  make `repo snapshot` work, and disclose it if so.
- Stale-recovery UX; evidence / `run_id` artifact ownership; worktree / shared-state architecture; status
  write-back; journal write.
- Executing the A+B live re-proof (separate governed step after merge).

## Discovery findings (inspected, not assumed)

1. **Which workflow calls use `runGitText`/`runGitInt`?** Seven call sites, five distinct facts:
   - `workflow.js:289` — `status --porcelain` → clean-tree precondition.
   - `:302` — `rev-parse --abbrev-ref HEAD` → `acquireBranch` (the `--branch` for `forge lock acquire`).
   - `:327` — `rev-parse HEAD` → `checkpointBase`.
   - `:501` — `status --porcelain` → `finalChangedFiles` (parsed).
   - `:511` — `rev-parse --abbrev-ref HEAD` → `branchName` (orchestrator-facts).
   - `:512` — `rev-list --count <base>..HEAD` → `aheadOfBase`.
   - `:614` — `rev-parse HEAD` → `checkpointHead`.
2. **Facts required BEFORE active-ticket emission (preflight):** clean-tree state, current branch
   (`acquireBranch`), and `checkpointBase` (head). One `forge repo snapshot --repo-root <r>` (no `--base`) yields
   `clean` + `branch` + `head` for all three.
3. **Facts required AFTER PM / at handoff:** `finalChangedFiles`, `branchName`, `aheadOfBase`, `checkpointHead`.
   One `forge repo snapshot --repo-root <r> --base <checkpointBase>` yields `changed_files` + `branch` + `head` +
   `ahead_of_base`.
4. **Can one `repo snapshot` replace all raw `git -C` calls?** Yes — two snapshot invocations (preflight without
   `--base`, handoff with `--base <checkpointBase>`) cover all seven raw-git call sites. (The engineer may call it
   at additional points if cleaner, as long as no raw `git`/`git -C` remains.)
5. **Does `ahead_of_base` require base/head inputs?** `head` is always the current HEAD. `ahead_of_base` is the
   count of `base..HEAD` and is computed **only when `--base` is provided**; when `--base` is absent it is `null`
   (omitted from the count, not fabricated as 0).
6. **How does `guard paths` run git without being blocked by the hook?** `src/guard/git.ts` calls
   `execFileSync("git", ["-C", repoRoot, "status", "--porcelain", "-z", "--untracked-files=all"], …)` directly
   from Core. That is a node child-process spawn, **not** a Bash tool call, so the PreToolUse Bash hook does not
   intercept it. `repo snapshot` reuses this exact mechanism (and may reuse `parsePorcelain` by importing it from
   the guard — import is allowed; editing the guard is not).
7. **Where should the new Core command live?** A new `src/repo/` module (`src/repo/snapshot.ts`), mirroring the
   `lock-cli` / `ledger-cli` shape: an injected git-reader seam + a `defaultRepoGit` real binding + a `runRepo`
   CLI adapter. Routed in `src/cli/run.ts` behind `options.repoGit ?? defaultRepoGit` (mirroring
   `options.lockIo ?? defaultLockIo`), with a `repo` route that dispatches `snapshot`, plus a `RunCliOptions`
   field, the import, and a `USAGE` line.
8. **Unit tests:** drive `runRepo` / the snapshot computation through an **injected in-memory git reader** for
   every fact (head, branch, clean vs dirty, changed_files incl. rename/untracked handling, ahead_of_base with and
   without `--base`, usage errors), plus **one real-fs temp-git test** that proves `defaultRepoGit` against an
   actual throwaway repo (init, commit, edit, branch — deterministic, cleaned up, no destructive op), mirroring
   `src/guard/git.test.ts`'s real-worktree test.
9. **Workflow protocol test proving raw `git -C` is gone:** extend
   `src/workflows/forge-run-ticket-workflow-lock.test.ts` (or a sibling block) with a **non-tautological** check:
   assert the workflow source now contains `forge repo snapshot` / `repo snapshot` and **no longer contains
   `git -C`** (nor the `runGitText`/`runGitInt` raw-git helpers); keep the existing lock-wiring assertions
   (acquire before active-ticket / checkpoint, owner-checked release, etc.) green.
10. **Allowed / forbidden paths:** see front-matter. Notably `src/guard/**` is **forbidden** (reused via import,
    never edited); `.claude/**` is forbidden (no hook change).

## Recommended Core command shape (PM-ratified)

`forge repo snapshot --repo-root <path> [--base <sha>]` → JSON to stdout, exit 0 on success, 1 on a typed failure
(e.g. not a git repo), 2 on usage error. Return shape:

```json
{
  "repo_root": "<absolute path as given>",
  "clean": true,
  "changed_files": [],
  "head": "<full sha>",
  "branch": "<current branch name>",
  "ahead_of_base": null
}
```

- `clean` is `changed_files.length === 0` (computed from `status --porcelain -z --untracked-files=all`, parsed like
  the guard so spaces/renames/untracked dirs are handled correctly).
- `ahead_of_base` is the integer `rev-list --count <base>..HEAD` **only when `--base` is supplied**, else `null`.
- All git runs internally via Core's `execFileSync` git binding; the command never shells git through Bash.

## AI Instructions

- TDD: write the failing Core unit tests first (injected reader, each fact), implement `src/repo/snapshot.ts` +
  the `repo` route, then write the failing workflow protocol assertions (raw `git -C` gone, `repo snapshot`
  present) and rewire the workflow to pass them.
- Reuse, don't re-edit: import `parsePorcelain` from `src/guard/git.ts` if helpful; do **not** edit the guard.
- Keep the workflow rewire surgical: replace the seven `runGitText`/`runGitInt` call sites with snapshot-derived
  values and drop the now-unused raw-git helpers; do not restructure unrelated phases, and **preserve the lock
  wiring** (acquire still before active-ticket emission and before checkpoint; owner-checked release on PASS /
  terminal; hold across CORRECT).
- Do not edit any Core module outside `src/repo/**` and `src/cli/run.ts`, the hook, the guard, the
  lock/ledger/schema/run-report modules, any agent, or any command. A needed change there is a halt-trigger.
- Do not loosen the permissions hook. Do not run the live workflow proof (separate step).
- Run `pnpm test` and `pnpm typecheck`; both must stay green.

## Acceptance Criteria

1. **snapshot head:** `forge repo snapshot` returns the current HEAD sha.
2. **snapshot branch:** it returns the current branch name.
3. **snapshot clean/dirty:** it reports `clean` accurately (true on a clean tree, false when changes exist).
4. **snapshot changed_files:** it returns the changed-file set (added/modified/deleted/untracked/rename handled),
   parsed like the guard.
5. **snapshot ahead_of_base:** it returns the integer `base..HEAD` count when `--base` is provided, and `null`
   when `--base` is absent.
6. **default binding proven:** a real-fs temp-git test proves `defaultRepoGit` against an actual repo; injected
   in-memory reader tests cover every fact + usage errors; the command never shells git through Bash.
7. **router:** `forge repo snapshot` is routed in `runCli` behind `options.repoGit ?? defaultRepoGit`; `USAGE`
   lists it; an invalid `forge repo <bad>` is a usage error.
8. **workflow no longer calls raw git:** `workflows/forge-run-ticket.workflow.js` contains no `git -C` (and no raw
   `git` inspection via the runner); the `runGitText`/`runGitInt` helpers are removed.
9. **workflow clean-tree uses snapshot:** the preflight clean-tree precondition is derived from `forge repo
   snapshot`.
10. **workflow checkpoint uses snapshot head;** **workflow branch uses snapshot branch;** **final changed-files /
    ahead-of-base use snapshot** (or an approved Core-owned equivalent).
11. **lock wiring preserved:** `forge lock acquire` still happens before active-ticket emission and before
    checkpoint/handoff mutations; owner-checked release on PASS/terminal; hold across CORRECT — i.e. the existing
    workflow lock-wiring assertions remain green.
12. **non-tautological proof:** the workflow protocol test asserts both the presence of `repo snapshot` wiring and
    the **absence** of `git -C` / the raw-git helpers.
13. **scope:** only `allowed_paths` change; the hook, guard, agents, commands, and lock/ledger/schema/run-report
    modules are untouched.
14. `pnpm test` passes (existing suite + the new repo-snapshot unit tests + the extended workflow protocol test).
    `pnpm typecheck` passes.

## Verification

- New `src/repo/**` unit tests (injected reader for every fact + one real-fs temp-git test for `defaultRepoGit`)
  and `src/cli/run.test.ts` route coverage, under `pnpm test` + `pnpm typecheck`.
- Extended `src/workflows/forge-run-ticket-workflow-lock.test.ts` (present `repo snapshot` + absent `git -C` /
  raw-git helpers + lock-wiring assertions still green).
- Governed two-pass verifiers review diff + proof; PM judges. **No live workflow execution in this ticket.**
- **Post-merge (separate governed step, not engineer-executable):** re-run the A+B live proof in the disposable
  clone to confirm the workflow now reaches `forge lock acquire` and completes the acquire→hold→release lifecycle
  under the live hook.

## Open decisions (for the PM)

1. **One ticket vs. split.** This ticket bundles the Core command + the workflow rewire because the command alone
   is dead code and the rewire alone has nothing to call — the fix isn't "done" until raw `git -C` is gone.
   **Recommended: keep as one ticket.** Alternative: split into T01 (Core `repo snapshot`) + T02 (workflow rewire,
   depends_on T01) for two smaller governed runs. Confirm.
2. **`changed_files` flag parity.** `repo snapshot` should parse with `--untracked-files=all` (like the guard) so
   untracked dirs/files are listed individually. Confirm that's the intended `changed_files` semantics for the
   run-report's `final_changed_files`.
3. **Scratch-file isolation** stays a separate follow-up unless the engineer finds it strictly required for
   `repo snapshot` to run safely (disclose if so).

## Implementation sequencing recommendation

After contract approval: one governed `/forge-run-ticket` self-run on this epic — RED the Core snapshot unit tests
→ implement `src/repo/snapshot.ts` + the `repo` route → RED the workflow protocol assertions → rewire the workflow
to eliminate raw `git -C` → engineer → verifiers → PM → stop at the commit gate. After merge (no install refresh —
neither `src/repo` nor the workflow is installed), **re-run the A+B live proof** in the disposable clone at
`D:/Projects/forge-workflow-live-proof` to confirm the workflow path is genuinely live-proven. Only then proceed to
stale-recovery UX / evidence-ownership / worktree-shared-state.
