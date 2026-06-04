---
schema_version: 1
id: T01
title: Add hook-backed permissions policy preserving runner no-outward-action
kind: green
risk: high
change_class: feature
blast_radius: app
status: pending
depends_on: []
blocks: []
allowed_paths:
  - .claude/settings.json
  - .claude/hooks/**
  - .gitignore
  - agents/forge-core-runner.md
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - src/**
  - commands/**
  - workflows/forge-run-ticket.workflow.js
  - agents/forge-engineer.md
  - agents/forge-semantic-verifier.md
  - agents/forge-scope-verifier.md
  - agents/forge-pm.md
  - package.json
  - pnpm-lock.yaml
  - tsconfig.json
  - vitest.config.ts
  - README.md
  - .github/**
  - docs/**
  - docs/governance/**
  - .claude/settings.local.json
  - sandbox-epic/**
  - pilot-local/**
  - "**/.forge/**"
---

# T01 — Add hook-backed permissions policy preserving runner no-outward-action

## Scope

Replace the broad static `permissions.deny` block with a **PreToolUse hook** that judges command *intent* by the
**four-class model** (see "Required policy behavior"), so a maintainer can use the ordinary GitHub workflow
through the agent — **safe read-only/local Git and explicit-path staging and the reversible PR workflow are
permitted**, while destructive/outward-risk operations are refused and a merge stays human-only. The
workflow-backed runner must stay outward-action-free at every layer. Direction: `docs/permissions-policy-discovery.md`
(PR #25), amended by `docs/permissions-policy-amendment-discovery.md` (PR #27) after the first shape proved
operationally unusable.

This ticket changes only the **substrate permission layer** (the hook + the project settings that registers it),
the narrow `.gitignore` exception that lets the hook be tracked, and the `forge-core-runner` charter (so the
runner's guarantee does not lean on a broad project deny alone). **No Forge Core (`src/**`) change.** If the work
appears to need a Core change, a package change, or a build change, **stop and report it in `deviations`** — that
is a re-scope, not a workaround.

## Out of Scope

- Any change to Forge Core (`src/**`), the orchestrator (`commands/forge-run-ticket.md`), the runner workflow
  (`workflows/forge-run-ticket.workflow.js`), or the four existing `forge-*` role charters.
- The adopter-facing strict/operator template split (deferred follow-up).
- Any package, lockfile, build, or CI change. If the hook cannot run as a self-contained script without one,
  STOP and surface it — do not widen scope silently.
- Auto-merge, or any relaxation of the human-gate thesis. A merge is still a human-approved action.

## Required policy behavior — four-class model (amended)

> **Amendment (2026-06-01):** the first implementation used "permit only the PR allow-shape, refuse every other
> git/gh mention." It was adversarially secure but **operationally unusable** — on activation it blocked safe
> read-only/local Git (`git status`, `git diff`, `git log`, `git add`, `git fetch`, `git switch`), making the repo
> unusable (see `docs/permissions-policy-amendment-discovery.md`, PR #27). The policy is re-scoped to **four
> command classes**. The proven deny engine (mention-scan + complete de-obfuscation + dynamic-program-token /
> command-substitution / grouping deny + runner L3) is **re-used**; this amendment **adds a safe-Git allowlist**
> (Classes 1–2) so daily Git works.

**Architectural rule (non-negotiable): do NOT refuse every git/gh mention.** Decide by shape:
- a **simple/static** command matching a **known-safe shape** (Class 1/2/3) → **ALLOW**;
- a **simple/static** command that is **not** a known-safe shape (an unknown or destructive git/gh form) → **DENY**;
- a **complex/dynamic/obfuscated** command that involves or could hide git/gh → **DENY** (the proven deny engine);
- a **non-git/gh** command → **PASS-THROUGH** (defer to normal flow).

**Class 1 — Safe local / read-only Git → PERMIT** (simple/static exact shapes): `git status`, `git diff`,
`git log`, `git show`, `git rev-parse`, `git branch` (list only), `git fetch`, `git pull --ff-only`,
`git switch <branch>`. (**`git checkout` is denied in EVERY form** — bare-positional `checkout` is git's silent
worktree-restore, which cannot be statically told apart from a branch name; branch navigation is `git switch
<branch>` only.) **Challenge destructive/unknown flags per command and DENY them**
(e.g. `git checkout -- <path>` / `git checkout .`, `-f`/`--force`/`--detach`/`--discard-changes`, `git clean`,
`git pull` without `--ff-only`).

**Class 2 — Safe staging → PERMIT (explicit paths only):** `git add <explicit-path>`. **DENY** broad staging:
`git add .`, `git add -A`, `git add --all`, `git add :/`, `git add *`, broad pathspecs. The hook is **not** the
path authority — Core `guard paths` / the scope verifier own path-fence compliance; the hook only permits
explicit-path staging.

**Class 3 — Safe PR workflow → PERMIT:** `git push -u|--set-upstream origin <feature-branch>` (non-default
branch only), `gh pr create`, `gh pr view`, `gh pr checks`.

**Class 4 — Destructive / approval-gated / unsafe → DENY:** force push (`--force`/`--force-with-lease`), direct
push to `main`/`master`, `git reset --hard`, branch deletion (`git branch -D`/`-M`), destructive `switch`/
`checkout` flags (`-c`/`-C`/`-b`/`-B`/`--detach`/`--force`/`--discard-changes`/`checkout -- <path>`),
**`git restore` and `git checkout -- <path>` (human-only this ticket)**, `git clean`, `git merge`, `git rebase`,
non-ff `git pull` (bare / `--rebase` / `--no-ff`), `gh pr merge` (human-only this ticket), `gh api` mutation,
`powershell`/`pwsh` and shell-bypass, dynamic program tokens, shell chaining/substitution/grouping around git/gh,
and any **unknown git/gh shape**.

The design seam is the **command class** (read-only/local/staging/PR = safe; destructive/outward = refused), not
"is it git or gh". `git status` is as safe as `pnpm test`; `git push --force` is not.

### `gh pr merge` is human-only for this ticket (sentinel deferred)

`gh pr merge` simply **denies** in this ticket — a maintainer performs the merge via `!`. The previously-specified
sentinel-gated merge (`.forge/approval/merge-pr-<N>-approved.json`) is a **DEFERRED FOLLOW_UP**, to be designed
in its own ticket after this four-class slice ships and soaks. **Do not implement sentinel logic now.**

## Required runner-safety preservation (three layers, none weakened)

The runner's no-outward-action guarantee must hold at all three layers after this change:

- **L1** — the runner workflow (`workflows/forge-run-ticket.workflow.js`) still contains **no outward-action
  stage**. (Unchanged by this ticket; re-confirm it is untouched.)
- **L2** — the `forge-core-runner` charter forbids outward actions and grants only the Forge CLI, read-only git,
  the ticket's verify command, and `.forge/**` writes. **Harden it** so the runner's discipline is explicit and
  self-standing — it must not depend on a broad project-level deny to be safe.
- **L3** — the hook refuses outward/mutating actions for the runner's agents. A **forge runner/role agent**
  (`forge-core-runner` or any `forge-*` role) may use **read-only Git only if needed** for evidence gathering —
  `git status`, `git diff`, `git log`, `git show`, `git rev-parse` — and is **DENIED ALL** staging, push, PR,
  merge, restore, `checkout`-write, `reset`, branch mutation, and `gh` (`git add`, `git push`, `git merge`,
  `git rebase`, `git reset`, `git restore`, `git checkout -- <path>`, `git branch -D`, `gh pr create`,
  `gh pr merge`, `gh api` mutation) — by every spelling. State explicitly in the implementation which layer
  refuses a runner-originated outward/mutating action and why that is sound.

## Required hook design decisions (answer before/within implementation)

These were posed in the discovery; the implementation must resolve each and record the answer:

1. **Where the hook lives and how Claude Code discovers it** — register a PreToolUse hook in
   `.claude/settings.json` pointing at a self-contained script under `.claude/hooks/`. The script must run with
   no package/build dependency (a plain Node `.mjs` or POSIX-safe script).
2. **Command-class discrimination** — the hook must reliably classify a command into the four classes: tell apart
   safe read-only/local Git (Class 1) and explicit-path staging (Class 2) and feature-branch push / `gh pr
   create|view|checks` (Class 3) from destructive/outward forms (Class 4: force-push, push-to-`main`,
   `reset --hard`, branch deletion, merge/rebase, `gh pr merge`, destructive flags), and refuse complex/dynamic/
   obfuscated forms. Document the matching approach and its limits. **Reuse the proven deny engine**; add the
   Class-1/2 safe-Git allowlist.
3. **`gh pr merge` is human-only** this ticket (simple deny); the sentinel-gated merge is a deferred follow-up.
4. **Fail-closed on error** — if the hook errors or cannot decide, it must **refuse** (default-deny), never
   default-allow.
5. **Testing without executing destructive operations** — prove the policy with a self-contained hook self-check
   that feeds representative tool-call inputs and asserts the Class-1/2/3 ALLOW, Class-4 DENY, pass-through, and
   fail-closed outcomes. No real force-push, hard-reset, branch deletion, or default-branch push is ever executed.
   **Plus the real-repo activation smoke test (AC 15): after the hook is live, `git status`/`diff`/`log` must
   still work** — run it in an isolated copy/worktree so a failure cannot lock the live session.
6. **Strict static floor stays** — even with the hook in place, keep a minimal static `permissions.deny` floor
   for the truly-irreversible operations (`git push --force`, `git reset --hard`, the bypass shells) so a hook
   failure cannot expose them. The hook adds nuance on top of a small, always-on static floor.

## Required `.gitignore` exception (narrow)

`.gitignore` currently has `.claude/*` + `!.claude/settings.json`, which would keep `.claude/hooks/` untracked.
Add the smallest exception so **only** the hook directory becomes tracked (for example re-include `.claude/hooks`
and its contents) while everything else under `.claude/` — including `.claude/settings.local.json` — stays
untracked. `.claude/settings.local.json` must remain untracked and is in `forbidden_paths`.

## AI Instructions

- This is a substrate-policy change, not a Core change. Do **not** edit `src/**`, `package.json`, the lockfile,
  `tsconfig.json`, `vitest.config.ts`, the runner workflow, or the four `forge-*` role charters. A needed change
  there is a halt-trigger reported in `deviations`, not a workaround.
- Keep a minimal static deny floor for the irreversible operations; let the hook add the reversible-workflow and
  approval-gated nuance. The hook must fail closed.
- Re-confirm the runner workflow has no outward-action stage (L1) and harden the `forge-core-runner` charter (L2)
  so the runner is safe without relying on a broad deny.
- Keep `.claude/settings.local.json` untracked; keep the `.gitignore` exception minimal.
- Prove the policy with a self-contained hook self-check; never execute a real destructive or default-branch
  operation to demonstrate refusal.
- Keep wording plain; do not reword strings other tests assert on. Run `pnpm test` and `pnpm typecheck` and
  confirm both stay green (this ticket adds no Core change, so the existing suite must remain unaffected).

## Acceptance Criteria

1. A PreToolUse hook is registered in `.claude/settings.json` and points at a self-contained script under
   `.claude/hooks/` that runs with no package/build dependency.
2. **Class 1 — operational read-only/local Git is ALLOWED:** `git status`, `git diff`, `git log`, `git show`,
   `git rev-parse`, `git branch` (list), `git fetch`, `git pull --ff-only`, `git switch <branch>` all permitted;
   their destructive/unknown flags denied. **`git checkout` is denied in EVERY form** — branch navigation is
   `git switch <branch>` only (bare-positional `checkout` is git's silent worktree-restore, which the hook cannot
   statically disambiguate from a branch name).
3. **Class 2 — staging:** `git add <explicit-path>` is ALLOWED; `git add .`, `git add -A`, `git add --all`,
   `git add :/`, `git add *` are DENIED.
4. **Class 3 — PR workflow is ALLOWED:** `git push -u|--set-upstream origin <feature-branch>`, `gh pr create`,
   `gh pr view`, `gh pr checks`.
5. **Class 4 — destructive/unsafe is DENIED:** force push, direct push to `main`/`master`, `git reset --hard`,
   branch deletion (`git branch -D`), destructive `switch`/`checkout` flags and `git checkout -- <path>`,
   `git restore`, `git clean`, `git merge`, `git rebase`, non-ff `git pull`, `gh pr merge`, `gh api` mutation,
   `powershell`/`pwsh` and shell-bypass, dynamic program tokens, shell chaining/substitution/grouping around
   git/gh, and any unknown git/gh shape — all refused (the proven deny-engine regression set is preserved).
6. The hook **fails closed**: on any error or undecidable input it refuses.
7. A minimal static `permissions.deny` floor remains for the irreversible operations (`git push --force`,
   `--force-with-lease`, `git reset --hard`, `powershell`, `pwsh`), independent of the hook.
8. **Non-git/gh commands PASS THROUGH** (defer to normal flow): `pnpm test`, `pnpm test && pnpm build`, `ls`,
   `node`, etc. are unaffected by the hook.
9. **Runner L3:** a forge runner/role agent is ALLOWED read-only Git (`git status`/`diff`/`log`/`show`/
   `rev-parse`) and is DENIED all staging/push/PR/merge/restore/`checkout`-write/`reset`/branch-mutation/`gh`
   by every spelling.
10. `.gitignore` tracks **only** the intended `.claude/hooks` exception; nothing else under `.claude/` becomes
    tracked; `.claude/settings.local.json` stays untracked.
11. The runner workflow is unchanged and still has no outward-action stage (L1); the `forge-core-runner` charter
    is hardened so the runner's no-outward-action discipline is self-standing (L2).
12. `src/**`, `commands/**`, the four `forge-*` role charters, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`,
    `vitest.config.ts`, `README.md`, `.github/**`, and `docs/**` are untouched.
13. A self-contained hook self-check demonstrates the Class-1/2/3 **ALLOW**, the Class-4 **DENY**, the
    pass-through, the runner L3, and fail-closed outcomes for representative inputs — executing no real
    destructive or default-branch operation.
14. `pnpm test` passes (535/37 unaffected). `pnpm typecheck` passes.
15. **Real-repo activation smoke test (load-bearing, BEFORE the commit gate).** After the artifacts are copied
    into the real repo and the hook is live, the orchestrator confirms the hook self-check passes AND **basic
    local Git still works**: `git status`, `git diff`, and `git log --oneline -3` all SUCCEED (are not refused).
    **If activation refuses normal local Git, the ticket FAILS** (this is the exact failure that opened the
    amendment). Run it in an isolated copy/worktree so a failure does not lock the live session.
16. **The artifact must not break a representative daily Git session** — the load-bearing operational guarantee
    of this ticket.

## Resolved decisions (ratified by the PM — amended 2026-06-01)

1. **Four-class model, not deny-all-mentions.** Safe local/read-only Git (Class 1) and explicit-path staging
   (Class 2) are PERMITTED alongside the PR workflow (Class 3); only destructive/approval-gated/unsafe (Class 4)
   is denied. The proven deny engine (mention-scan + de-obfuscation + dynamic-token/grouping deny + runner L3) is
   re-used; this amendment adds the Class-1/2 safe-Git allowlist. Layered: a minimal static deny floor remains.
2. **`git add`:** explicit-path staging only (`git add <path>`); `git add .`/`-A`/`--all`/`:/`/`*` denied. The
   hook is not the path authority (Core guard/scope verifier own that).
3. **`git restore` / `git checkout -- <path>`:** human-only this ticket → DENY (locally destructive; a scoped
   policy can follow later).
4. **`git pull`:** `--ff-only` only; bare / `--rebase` / `--no-ff` denied.
5. **`git switch`:** simple branch navigation only (`git switch <branch>`); `-c`/`-C`/`--detach`/`--force`/
   `--discard-changes` denied. **`git checkout`: denied in EVERY form** — bare-positional `checkout` can restore
   files from the index/worktree ambiguity, so branch navigation is `git switch <branch>` only; `-b`/`-B`/
   `--detach`/`--force`/`checkout -- <path>` all denied.
6. **`gh pr merge`:** human-only this ticket → DENY. Sentinel-gated merge is a DEFERRED FOLLOW_UP (own ticket).
7. **Runner agents:** read-only Git only (`status`/`diff`/`log`/`show`/`rev-parse`); all staging/push/PR/merge/
   restore/`checkout`-write/`reset`/branch-mutation/`gh` denied.
8. **Load-bearing AC:** the artifact must not break a representative daily Git session; a real-repo activation
   smoke test (AC 15) gates the commit.
9. **`blast_radius: app`** — `repo` is not a schema enum value; `app` is the repo-wide-tooling tier.
