---
description: Import a legacy sprint folder into a Forge contract using the Forge CLI.
argument-hint: --from-existing <legacy-sprint-path> --out <epic-root> [--dry-run]
allowed-tools: Bash(forge:*), Bash(pnpm:*)
---
Thin wrapper around the **Forge CLI** importer. The Forge core is the source of truth — this command
adds no import logic and never invents missing metadata.

Import arguments: `$ARGUMENTS`

1. Run the Forge CLI: `forge import $ARGUMENTS`
   - Binary resolution: `forge` on PATH; else `$FORGE_BIN`; else, **local dev only**,
     `pnpm -C "${FORGE_REPO:-D:/Projects/forge}" forge import $ARGUMENTS`.
2. Relay the outcome:
   - **Dry-run** (`--dry-run`): list planned canonical target files and all ambiguity findings; nothing is written.
   - **Live**: which canonical files were written, whether the generated contract is execution-ready, and the
     location of `.forge/import-report.json`.
3. If the importer refuses (e.g. non-empty output `IMPORT_OUTPUT_EXISTS`), say so plainly.
4. If the generated contract is **not execution-ready**, state that it is a human-completion draft: ambiguous
   fields were written as `TODO` (not invented) and must be completed before execution.

Do not edit the legacy source. Do not complete `TODO`s automatically — that requires a human decision.
