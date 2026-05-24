---
description: Preview the next Forge ticket to run (read-only) using the Forge CLI.
argument-hint: <epic-path>
allowed-tools: Bash(node:*)
---
Thin wrapper around the **Forge CLI** run planner. Forge Core is the source of truth — this command adds
no selection logic, runs no agents, and edits no files.

Run **exactly** this single command with the Bash tool (after `$ARGUMENTS` is substituted), then relay the
output faithfully:

```bash
node "${FORGE_REPO:-D:/Projects/forge}/scripts/run-forge-cli.mjs" run $ARGUMENTS --dry-run
```

The resolver picks the Forge CLI deterministically: `$FORGE_BIN` → `forge` on `PATH` → local-dev `pnpm`
fallback. `FORGE_REPO` defaults to the **local-dev** repo path.

Then relay the plan faithfully: next ready ticket (or `BLOCKED` + reasons), dependency reasoning,
allowed/forbidden paths, verify commands, declared vs effective gate, proposed branch, and the agent chain
that **would** run. Make clear it changed nothing ("No files changed") and that **live execution does not
exist yet** — this is a decision preview only. Do not edit any files; do not dispatch agents.
