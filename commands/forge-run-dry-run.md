---
description: Preview the next Forge ticket to run (read-only) using the Forge CLI.
argument-hint: <epic-path>
allowed-tools: Bash(forge:*), Bash(pnpm:*)
---
Thin wrapper around the **Forge CLI** run planner. Forge Core is the source of truth — this command adds
no selection logic, runs no agents, and edits no files.

Run **exactly** the following with the Bash tool (after `$ARGUMENTS` is substituted), then relay the
CLI output faithfully. Binary resolution: `$FORGE_BIN` overrides `PATH`; then `forge` on `PATH`; then a
**local-dev-only** `pnpm` fallback.

```bash
# FORGE_REPO is a LOCAL-DEV fallback only. For real use, set FORGE_BIN or `pnpm link --global` the CLI.
if [ -n "$FORGE_BIN" ]; then
  "$FORGE_BIN" run $ARGUMENTS --dry-run
elif command -v forge >/dev/null 2>&1; then
  forge run $ARGUMENTS --dry-run
else
  pnpm -C "${FORGE_REPO:-D:/Projects/forge}" forge run $ARGUMENTS --dry-run
fi
```

Then relay the plan faithfully: next ready ticket (or `BLOCKED` + reasons), dependency reasoning,
allowed/forbidden paths, verify commands, declared vs effective gate, proposed branch, and the agent chain
that **would** run. Make clear it changed nothing ("No files changed") and that **live execution does not
exist yet** — this is a decision preview only. Do not edit any files; do not dispatch agents.
