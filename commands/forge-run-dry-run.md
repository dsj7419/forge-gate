---
description: Preview the next Forge ticket to run (read-only) using the Forge CLI.
argument-hint: <epic-path>
allowed-tools: Bash(node:*), Bash(git:*)
---
Thin wrapper around the **Forge CLI** run planner. Forge Core is the source of truth — this command adds
no selection logic, runs no agents, and edits no files.

Run the following with the Bash tool (after `$ARGUMENTS` is substituted), then relay the output faithfully.
It resolves the **target repo** from your current session and passes Core an **absolute** epic path, so it is
correct even when the resolver runs the CLI from the ForgeGate checkout (`$FORGE_REPO` is only the CLI locator,
never the target):

```bash
TARGET_REPO="$(git rev-parse --show-toplevel)"
EPIC="$ARGUMENTS"; case "$EPIC" in /*|[A-Za-z]:[\\/]*) ;; *) EPIC="$TARGET_REPO/$EPIC" ;; esac
node "${FORGE_REPO:?set FORGE_REPO to your forge-gate checkout}/scripts/run-forge-cli.mjs" run "$EPIC" --dry-run
```

The resolver picks the Forge CLI deterministically: `$FORGE_BIN` → `forge` on `PATH` → local-dev `pnpm`
fallback. `FORGE_REPO` must point to your forge-gate checkout (or put `forge` on `PATH`).

Then relay the plan faithfully: next ready ticket (or `BLOCKED` + reasons), dependency reasoning,
allowed/forbidden paths, verify commands, declared vs effective gate, proposed branch, and the agent chain
that **would** run. Make clear it changed nothing ("No files changed") and that **live execution does not
exist yet** — this is a decision preview only. Do not edit any files; do not dispatch agents.
