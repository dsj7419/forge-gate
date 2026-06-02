# Epic — Claude Code permissions-policy refinement

## Why

ForgeGate ships `.claude/settings.json` with a broad `permissions.deny` block — the v1 substrate backstop that
stops agents from taking outward actions (push, commit, merge, all `gh`, and the PowerShell-through-Bash bypass).
That backstop works, but it conflates three concerns in one file: **product safety policy**, the **runner's
substrate backstop**, and **operator convenience for normal PR workflow**. Because Claude Code's `deny` outranks
`allow` across every settings layer, a maintainer cannot layer convenience on top locally — the only ways to let
the agent run the ordinary PR workflow are to change the shipped policy or to add a more precise mechanism.

The discovery (`docs/permissions-policy-discovery.md`, landed via PR #25) recommends the principled path:
a **PreToolUse hook** that judges command *intent* — allow the reversible PR workflow, refuse irreversible /
destructive operations, and require explicit human approval for a merge — while the workflow-backed runner stays
outward-action-free at every layer.

## Goal

Let a maintainer use the normal, reversible GitHub PR workflow through the agent, refuse destructive operations,
gate merges on explicit human approval, and keep the runner's no-outward-action guarantee fully intact.

## Sprints

- `sprint-01-permissions-policy` — the single refinement ticket (hook-backed policy + runner-charter hardening).

## Out of scope (this epic)

- Any change to Forge Core (`src/**`) or the orchestrator/runner workflow code.
- The adopter-facing strict/operator template split (a deliberate follow-up once this repo's own policy is settled).
- Relaxing the human-gate thesis: the human still approves every outward action that matters.
