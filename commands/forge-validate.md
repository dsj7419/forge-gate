---
description: Validate a Forge epic contract (read-only) using the Forge CLI.
argument-hint: <epic-path>
allowed-tools: Bash(node:*)
---
Thin wrapper around the **Forge CLI**. Forge Core is the source of truth — this command adds no
validation logic of its own and edits no files.

Run **exactly** this single command with the Bash tool (after `$ARGUMENTS` is substituted), then relay the
output faithfully:

```bash
node "${FORGE_REPO:?set FORGE_REPO to your forge-gate checkout}/scripts/run-forge-cli.mjs" validate $ARGUMENTS
```

The resolver picks the Forge CLI deterministically: `$FORGE_BIN` → `forge` on `PATH` → local-dev
`pnpm` fallback. `FORGE_REPO` must point to your forge-gate checkout; set it (or `pnpm link --global`
the CLI) for real use.

Then report: `OK` or `FAILED`, and every finding (code, message, file/sprint/ticket). If `FAILED`, say the
contract is **not execution-ready** and summarize what to fix. Note default mode writes
`.forge/validation-report.json`. Do not edit any files; do not reimplement validation.
