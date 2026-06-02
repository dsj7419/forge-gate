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

Replace the broad static `permissions.deny` block with a **PreToolUse hook** that judges command *intent*, so a
maintainer can use the ordinary, reversible GitHub PR workflow through the agent while irreversible and
destructive operations are refused and a merge is gated on explicit human approval. The workflow-backed runner
must stay outward-action-free at every layer. This is the principled direction from
`docs/permissions-policy-discovery.md` (landed PR #25).

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

## Required policy behavior

The active policy (hook plus the settings that register it) must, **for an interactive maintainer session**:

**Permit (reversible PR workflow, as part of an approved PR-safe flow):**
- `git push -u origin <feature-branch>` (a non-default branch only)
- `gh pr create`
- `gh pr view`
- `gh pr checks`

**Refuse (always):**
- `git push --force` (and `--force-with-lease` history rewrites)
- `git reset --hard`
- a direct push to the default branch (`main`)
- unsafe branch deletion (force branch deletion of an unmerged branch)
- `powershell` / `pwsh` invocations and any shell-bypass pattern that routes a refused command through another
  shell

**Approval-gated (refuse unless an explicit, matching, unexpired sentinel is present):**
- `gh pr merge <N>` — permitted only when the human-created approval sentinel (below) exists for that exact PR
  number and merge action and is still valid. Absent or non-matching, the hook refuses.

The design seam is **reversibility**: a feature-branch push or an opened PR is reversible/reviewable; a merge,
a force-push, or a hard-reset is not. Gate on that property, not on "is it git or gh".

### Required merge-approval mechanism (ratified)

A merge is gated on an explicit, short-lived **sentinel file** the human creates — never a vague session marker
and never a permanent grant. The hook permits `gh pr merge <N>` **only** when a sentinel under
`.forge/approval/` exists, matches the target PR number, names the exact merge action, and has not expired or
been consumed.

- Location/name: `.forge/approval/merge-pr-<N>-approved.json` (for example `.forge/approval/merge-pr-25-approved.json`).
- Required fields: `pr_number`, `approved_action` (the exact action, e.g. `pr_merge`), `created_at`, and either
  `expires_at` **or** `single_use: true`.
- The hook **reads** the sentinel (it never creates one); the human creates it to authorize one specific merge.
- The hook refuses the merge if the sentinel is absent, names a different PR number or action, is expired, or
  (when `single_use`) has already been consumed. `.forge/approval/` is gitignored runtime state (under `.forge/`),
  created out-of-band by the human — it is **not** an artifact this ticket writes.

## Required runner-safety preservation (three layers, none weakened)

The runner's no-outward-action guarantee must hold at all three layers after this change:

- **L1** — the runner workflow (`workflows/forge-run-ticket.workflow.js`) still contains **no outward-action
  stage**. (Unchanged by this ticket; re-confirm it is untouched.)
- **L2** — the `forge-core-runner` charter forbids outward actions and grants only the Forge CLI, read-only git,
  the ticket's verify command, and `.forge/**` writes. **Harden it** so the runner's discipline is explicit and
  self-standing — it must not depend on a broad project-level deny to be safe.
- **L3** — the hook/settings policy refuses outward actions for the runner's agents. Because L3 is no longer a
  blanket deny, the hook must still refuse a runner-originated outward action (or the charter L2 + the workflow
  L1 must be demonstrably sufficient on their own). State explicitly in the implementation which layer refuses a
  runner push and why that is sound.

## Required hook design decisions (answer before/within implementation)

These were posed in the discovery; the implementation must resolve each and record the answer:

1. **Where the hook lives and how Claude Code discovers it** — register a PreToolUse hook in
   `.claude/settings.json` pointing at a self-contained script under `.claude/hooks/`. The script must run with
   no package/build dependency (a plain Node `.mjs` or POSIX-safe script).
2. **Command discrimination** — the hook must reliably tell apart: a feature-branch push vs a direct push to
   `main` vs a force-push; a normal `gh pr create/view/checks` vs `gh pr merge`; and a shell-bypass attempt.
   Document the matching approach and its limits.
3. **Encoding explicit human approval for a merge** — define the concrete signal the hook reads to treat a merge
   as approved, and confirm an unapproved merge is refused.
4. **Fail-closed on error** — if the hook errors or cannot decide, it must **refuse** (default-deny), never
   default-allow.
5. **Testing without executing destructive operations** — prove the policy with a self-contained hook self-check
   that feeds representative tool-call inputs and asserts permit/refuse/approval-gated outcomes. No real
   force-push, hard-reset, branch deletion, or default-branch push is ever executed.
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
2. The hook **permits**: `git push -u origin <feature-branch>`, `gh pr create`, `gh pr view`, `gh pr checks`.
3. The hook **refuses**: `git push --force`, `git reset --hard`, a direct push to `main`, force branch deletion
   of an unmerged branch, and `powershell`/`pwsh` / shell-bypass patterns.
4. The hook treats `gh pr merge <N>` as **approval-gated** by the sentinel mechanism — refused unless a matching,
   valid `.forge/approval/merge-pr-<N>-approved.json` (right PR number + `approved_action` + unexpired/unconsumed)
   exists; a missing, mismatched, expired, or consumed sentinel is refused.
5. The hook **fails closed**: on any error or undecidable input it refuses.
6. A minimal static `permissions.deny` floor remains for the irreversible operations (`git push --force`,
   `git reset --hard`, bypass shells), independent of the hook.
7. `.gitignore` tracks **only** the intended `.claude/hooks` exception; nothing else under `.claude/` becomes
   tracked; `.claude/settings.local.json` stays untracked.
8. The runner workflow (`workflows/forge-run-ticket.workflow.js`) is unchanged and still has no outward-action
   stage (L1); the `forge-core-runner` charter is hardened so the runner's no-outward-action discipline is
   self-standing (L2); the implementation states which layer refuses a runner-originated outward action.
9. `src/**`, `commands/**`, the four `forge-*` role charters, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`,
   `vitest.config.ts`, `README.md`, `.github/**`, and `docs/**` are untouched.
10. A self-contained hook self-check demonstrates the permit / refuse / approval-gated outcomes for
    representative inputs, executing no real destructive or default-branch operation.
11. `pnpm test` passes (535/37 unaffected).
12. `pnpm typecheck` passes.

## Resolved decisions (ratified by the PM)

1. **Layered model, not hook-only.** A minimal always-on static deny floor for the irreversible/destructive
   operations **plus** the PreToolUse hook for nuance (AC 6). The policy never relies on the hook alone.
2. **Feature-branch push only inside an approved PR-safe flow** — `git push -u origin <feature-branch>` is
   permitted; direct push to the default branch, force-push, unsafe branch deletion, and hard-reset stay refused.
3. **Merge approval is a short-lived sentinel file** under `.forge/approval/` (see "Required merge-approval
   mechanism" above): the hook permits `gh pr merge <N>` only for a matching, unexpired/unconsumed sentinel.
   No vague session marker; no permanent grant.
4. **`blast_radius: app`** — `repo` is not a schema enum value; `app` is the repo-wide-tooling tier.
