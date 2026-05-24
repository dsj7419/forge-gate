---
description: Import a legacy sprint folder into a Forge contract using the Forge CLI.
argument-hint: --from-existing <legacy-sprint-path> --out <epic-root> [--dry-run]
allowed-tools: Bash(node:*)
---
Thin wrapper around the **Forge CLI** importer. Forge Core is the source of truth — this command adds
no import logic and never invents missing metadata.

Run **exactly** this single command with the Bash tool (after `$ARGUMENTS` is substituted), then relay the
output faithfully:

```bash
node "${FORGE_REPO:?set FORGE_REPO to your forge-gate checkout}/scripts/run-forge-cli.mjs" import $ARGUMENTS
```

The resolver picks the Forge CLI deterministically: `$FORGE_BIN` → `forge` on `PATH` → local-dev `pnpm`
fallback. `FORGE_REPO` must point to your forge-gate checkout (or put `forge` on `PATH`).

Then relay the outcome:
- **Dry-run** (`--dry-run`): planned canonical target files + all ambiguity findings; nothing is written.
- **Live**: which canonical files were written, whether the generated contract is execution-ready, and the
  `.forge/import-report.json` location.
- If the importer refuses (e.g. `IMPORT_OUTPUT_EXISTS`), say so plainly.
- If the generated contract is **not execution-ready**, state it is a human-completion draft: ambiguous fields
  were written as `TODO` (not invented) and need a human before execution.

Do not edit the legacy source. Do not complete `TODO`s automatically — that requires a human decision.
