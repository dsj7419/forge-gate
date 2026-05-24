---
description: Import a legacy sprint folder into a Forge contract using the Forge CLI.
argument-hint: --from-existing <legacy-sprint-path> --out <epic-root> [--dry-run]
allowed-tools: Bash(forge:*), Bash(pnpm:*)
---
Thin wrapper around the **Forge CLI** importer. Forge Core is the source of truth — this command adds
no import logic and never invents missing metadata.

Run **exactly** the following with the Bash tool (after `$ARGUMENTS` is substituted), then relay the
CLI output faithfully. Binary resolution: `$FORGE_BIN` overrides `PATH`; then `forge` on `PATH`; then a
**local-dev-only** `pnpm` fallback.

```bash
# FORGE_REPO is a LOCAL-DEV fallback only. For real use, set FORGE_BIN or `pnpm link --global` the CLI.
if [ -n "$FORGE_BIN" ]; then
  "$FORGE_BIN" import $ARGUMENTS
elif command -v forge >/dev/null 2>&1; then
  forge import $ARGUMENTS
else
  pnpm -C "${FORGE_REPO:-D:/Projects/forge}" forge import $ARGUMENTS
fi
```

Then relay the outcome:
- **Dry-run** (`--dry-run`): planned canonical target files + all ambiguity findings; nothing is written.
- **Live**: which canonical files were written, whether the generated contract is execution-ready, and the
  `.forge/import-report.json` location.
- If the importer refuses (e.g. `IMPORT_OUTPUT_EXISTS`), say so plainly.
- If the generated contract is **not execution-ready**, state it is a human-completion draft: ambiguous fields
  were written as `TODO` (not invented) and need a human before execution.

Do not edit the legacy source. Do not complete `TODO`s automatically — that requires a human decision.
