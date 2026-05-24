---
description: Summarize a Forge epic contract (read-only) using the Forge CLI.
argument-hint: <epic-path>
allowed-tools: Bash(forge:*), Bash(pnpm:*)
---
Thin wrapper around the **Forge CLI**. Forge Core is the source of truth — this command adds no logic
and edits no files.

Run **exactly** the following with the Bash tool (after `$ARGUMENTS` is substituted), then relay the
CLI output faithfully. Binary resolution: `$FORGE_BIN` overrides `PATH`; then `forge` on `PATH`; then a
**local-dev-only** `pnpm` fallback.

```bash
# FORGE_REPO is a LOCAL-DEV fallback only. For real use, set FORGE_BIN or `pnpm link --global` the CLI.
if [ -n "$FORGE_BIN" ]; then
  "$FORGE_BIN" status $ARGUMENTS
elif command -v forge >/dev/null 2>&1; then
  forge status $ARGUMENTS
else
  pnpm -C "${FORGE_REPO:-D:/Projects/forge}" forge status $ARGUMENTS
fi
```

Then report: epic id, sprint ids, per-sprint ticket counts, and finding totals. If the contract cannot
load at all, say so (the CLI exits non-zero only in that case). Do not edit any files; do not reimplement loading.
