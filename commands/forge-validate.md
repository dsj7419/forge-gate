---
description: Validate a Forge epic contract (read-only) using the Forge CLI.
argument-hint: <epic-path>
allowed-tools: Bash(forge:*), Bash(pnpm:*)
---
Thin wrapper around the **Forge CLI**. Forge Core is the source of truth — this command adds no
validation logic of its own and edits no files.

Run **exactly** the following with the Bash tool (after `$ARGUMENTS` is substituted), then relay the
CLI output faithfully. Binary resolution is deterministic: `$FORGE_BIN` overrides `PATH`; then `forge`
on `PATH`; then a **local-dev-only** `pnpm` fallback.

```bash
# FORGE_REPO is a LOCAL-DEV fallback only. For real use, set FORGE_BIN or `pnpm link --global` the CLI.
if [ -n "$FORGE_BIN" ]; then
  "$FORGE_BIN" validate $ARGUMENTS
elif command -v forge >/dev/null 2>&1; then
  forge validate $ARGUMENTS
else
  pnpm -C "${FORGE_REPO:-D:/Projects/forge}" forge validate $ARGUMENTS
fi
```

Then report: `OK` or `FAILED`, and every finding (code, message, file/sprint/ticket). If `FAILED`, say the
contract is **not execution-ready** and summarize what to fix. Note that default mode writes
`.forge/validation-report.json` under the epic path. Do not edit any files; do not reimplement validation.
