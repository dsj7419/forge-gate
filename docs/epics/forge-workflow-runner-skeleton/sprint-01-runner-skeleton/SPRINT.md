# Sprint 01 — Workflow-backed runner skeleton

**Epic:** forge-workflow-runner-skeleton
**Status:** active
**Integration base:** main

## Goal

Add the first reviewed workflow-backed runner skeleton — a tracked workflow script, a narrow `forge-core-runner`
agent charter, and a tracked `permissions.deny` backstop — proven by a manual run on `sandbox-epic` to a
commit-gate PASS. Pure assembly over existing Forge Core: every trust boundary stays a Core CLI call; the
workflow owns only sequencing; the human owns every outward action.

## Tickets

- **T01** — Add the workflow-backed runner skeleton.

## Halt-triggers

Any `src/**` change (the skeleton must be pure assembly — a needed Core change means re-scope, not a workaround);
any edit to `commands/forge-run-ticket.md` or the four existing `forge-*` charters; any outward-action stage in
the workflow (commit / push / PR / merge); tracking `.claude/settings.local.json`; tracking anything in
`.claude/` other than `settings.json`; any weakening of the path fences, `parse-agent` validation, Core-pinned
gate, Core-pinned decision_id, Core-owned ledger append, or the literal-false run-report safety model; a failing
verify command after the correction cap.
