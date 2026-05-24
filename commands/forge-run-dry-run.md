---
description: Preview the next Forge ticket to run (read-only) using the Forge CLI.
argument-hint: <epic-path>
allowed-tools: Bash(forge:*), Bash(pnpm:*)
---
Thin wrapper around the **Forge CLI** run planner. The Forge core is the source of truth — this command
adds no selection logic, runs no agents, and edits no files.

Preview the next ready ticket for the epic at: `$ARGUMENTS`

1. Run the Forge CLI (read-only, dry-run): `forge run $ARGUMENTS --dry-run`
   - Binary resolution: `forge` on PATH; else `$FORGE_BIN`; else, **local dev only**,
     `pnpm -C "${FORGE_REPO:-D:/Projects/forge}" forge run $ARGUMENTS --dry-run`.
2. Relay the plan faithfully: next ready ticket (or `BLOCKED` + reasons), dependency reasoning, allowed/forbidden
   paths, verify commands, declared vs effective gate, proposed branch, and the agent chain that **would** run.
3. Make clear this changed nothing ("No files changed") and that **live execution does not exist yet** — this is
   a decision preview only.

Do not edit any files. Do not dispatch agents. Do not reimplement run selection.
