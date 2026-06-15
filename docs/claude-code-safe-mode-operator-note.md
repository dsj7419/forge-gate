# Operator note — Claude Code safe mode disables enforcement

> **Operator safety, documentation only.** This note records a substrate hazard and the operator rule that follows
> from it. It does **not** add detection, change the hook, or change any Forge behavior.

## Problem

Claude Code **safe mode** — launching with `--safe-mode`, or with the `CLAUDE_CODE_SAFE_MODE` environment variable
set — can disable Claude Code **customizations**. Those customizations include **hooks**, and therefore the
ForgeGate **L3 PreToolUse permissions hook** (`.claude/hooks/forge-permissions.mjs`, registered in
`.claude/settings.json`) that classifies and gates every `git`/`gh` command.

The hazard is that this happens **silently**: a session launched in safe mode looks normal, but the mechanical
prevent layer is not active.

## Why it matters for ForgeGate

ForgeGate's safety comes from distinct layers — *Core attests, the guard detects, the permissions hook prevents,
and the human approves.* The permissions hook is the **prevent** layer: it is what blocks destructive/outward
`git`/`gh` actions at the tool boundary (force-push, push-to-main, `merge`, `gh pr merge`, branch delete, and any
complex/obfuscated form), and it is what restricts a `forge-*` runner agent to read-only git.

If a governed run (`/forge-run-ticket` or a workflow-backed run) is launched from a **safe-mode** session, that
prevent layer can be **off without warning**. The other layers still operate (Core still attests, the guard still
detects post-hoc, the human still approves at the gate), but the per-action substrate gating that the run relies on
may be absent — an agent Bash action that would normally be denied could execute. That is a real, undetected
weakening of the safety model.

## Operator rule

- **Do not run `/forge-run-ticket` or a governed Forge workflow from a safe-mode session.**
- If safe mode is enabled (`--safe-mode` flag, or `CLAUDE_CODE_SAFE_MODE` set), **exit and relaunch Claude Code
  normally** before running ForgeGate orchestration.
- The read-only Forge CLI subcommands (`validate`, `run --dry-run`, `status`) are safe from any plain terminal;
  this rule is specifically about the **governed orchestration loop**, where the hook is load-bearing.

## Deferred follow-up — optional preflight detection (not in this note)

A future, separate unit could add a **preflight check** that detects an active safe-mode session and refuses to
start a governed run (fail-closed), so the operator rule is mechanically enforced rather than documented. That is
**implementation** (it would touch the orchestrator / a preflight surface) and is intentionally **deferred** —
this note is the documentation-only first step.

## Non-goals

- **No source-code detection** in this change — documentation only.
- **No hook changes.**
- **No permission-model changes.**
- **No charter changes.**
- **No workflow changes.**
- **No install refresh** — no installed files (`commands/**`, `agents/**`) are touched.
