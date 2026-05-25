---
description: Validate a Forge epic contract (read-only) using the Forge CLI.
argument-hint: <epic-path>
allowed-tools: Bash(node:*), Bash(git:*)
---
Thin wrapper around the **Forge CLI**. Forge Core is the source of truth — this command adds no
validation logic of its own and edits no files.

Run the following with the Bash tool (after `$ARGUMENTS` is substituted), then relay the output faithfully.
It resolves the **target repo** from your current session and passes Core an **absolute** epic path, so it is
correct even when the resolver runs the CLI from the ForgeGate checkout (`$FORGE_REPO` is only the CLI locator,
never the target):

```bash
TARGET_REPO="$(git rev-parse --show-toplevel)"
EPIC="$ARGUMENTS"; case "$EPIC" in /*|[A-Za-z]:[\\/]*) ;; *) EPIC="$TARGET_REPO/$EPIC" ;; esac
node "${FORGE_REPO:?set FORGE_REPO to your forge-gate checkout}/scripts/run-forge-cli.mjs" validate "$EPIC"
```

The resolver picks the Forge CLI deterministically: `$FORGE_BIN` → `forge` on `PATH` → local-dev
`pnpm` fallback. `FORGE_REPO` must point to your forge-gate checkout; set it (or `pnpm link --global`
the CLI) for real use.

Then report: `OK` or `FAILED`, and every finding (code, message, file/sprint/ticket). If `FAILED`, say the
contract is **not execution-ready** and summarize what to fix. Note default mode writes
`.forge/validation-report.json`. Do not edit any files; do not reimplement validation.
