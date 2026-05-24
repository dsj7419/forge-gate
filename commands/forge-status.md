---
description: Summarize a Forge epic contract (read-only) using the Forge CLI.
argument-hint: <epic-path>
allowed-tools: Bash(node:*)
---
Thin wrapper around the **Forge CLI**. Forge Core is the source of truth — this command adds no logic
and edits no files.

Run **exactly** this single command with the Bash tool (after `$ARGUMENTS` is substituted), then relay the
output faithfully:

```bash
node "${FORGE_REPO:-D:/Projects/forge}/scripts/run-forge-cli.mjs" status $ARGUMENTS
```

The resolver picks the Forge CLI deterministically: `$FORGE_BIN` → `forge` on `PATH` → local-dev `pnpm`
fallback. `FORGE_REPO` defaults to the **local-dev** repo path.

Then report: epic id, sprint ids, per-sprint ticket counts, and finding totals. If the contract cannot
load at all, say so (the CLI exits non-zero only in that case). Do not edit any files; do not reimplement loading.
