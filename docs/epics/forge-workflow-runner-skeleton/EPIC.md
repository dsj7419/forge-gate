# Epic — Workflow-backed runner skeleton

**Status:** active
**Integration base:** main

## Why

The provenance chain is closed (gate B1/PR #14, decision-id B2/PR #18, source-tracking 1c/PR #20, ledger C4,
structured ingest). A 2026-05-31 empirical spike (`docs/workflow-backed-runner-skeleton-discovery.md` §0)
confirmed the three load-bearing Claude Code platform facts: workflow `agent({schema})` returns a typed object,
`agentType` resolves and honors tool-name grants, and **workflow agents honor `permissions.deny`** (the
PowerShell-through-Bash bypass was blocked). The runner is unblocked.

This epic builds the **first reviewed workflow-backed runner skeleton** — the smallest governed step that proves
a Claude Code dynamic workflow can drive the existing Forge Core to a safe commit-gate handoff, while keeping the
doctrine intact: **the workflow executes, Forge Core governs, the human approves the outward action.**

Discovery verified the boundary precisely: a pure-JSON agent-output file validates through both the YAML
`--file` path and the structured `--json-file` path (JSON is a subset of YAML), so the workflow can persist
structured `.forge/<role>-output.json` and feed every existing Core command unchanged. **No `src/**` change is
required — this is pure assembly over existing Core.**

## What

- A tracked workflow script `workflows/forge-run-ticket.workflow.js` with **no outward-action stage**.
- A tracked, narrow-grant `forge-core-runner` agent charter (`agents/forge-core-runner.md`).
- A tracked project `permissions.deny` backstop in `.claude/settings.json` (made trackable by a narrow
  `.gitignore` exception; `.claude/settings.local.json` stays untracked).
- A manual proof run on `sandbox-epic` to a commit-gate PASS — the acceptance evidence.

## Out of scope

- Any `src/**` change. If implementation appears to need one, **stop and escalate** — the skeleton is then not
  pure assembly and the contract must be re-scoped.
- Editing `commands/forge-run-ticket.md` (the maintained Markdown fallback stays untouched; no sunset) or the
  four existing `forge-*` charters.
- Any outward action: commit, push, PR, merge, status write-back, journal write.
- `PreToolUse` hooks (deferred; `permissions.deny` is the v1 backstop), multi-ticket behavior, branch creation
  by the runner (the human/launcher prepares the branch), package/install distribution of the workflow, and
  promoting the runner to the default path.

## Sprints

- **sprint-01-runner-skeleton** — T01: add the workflow-backed runner skeleton.
