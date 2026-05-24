---
description: Summarize a Forge epic contract (read-only) using the Forge CLI.
argument-hint: <epic-path>
allowed-tools: Bash(forge:*), Bash(pnpm:*)
---
Thin wrapper around the **Forge CLI**. The Forge core is the source of truth — this command adds no
logic and edits no files.

Summarize the epic contract at: `$ARGUMENTS`

1. Run the Forge CLI (read-only): `forge status $ARGUMENTS`
   - Binary resolution: `forge` on PATH; else `$FORGE_BIN`; else, **local dev only**,
     `pnpm -C "${FORGE_REPO:-D:/Projects/forge}" forge status $ARGUMENTS`.
2. Relay: epic id, sprint ids, per-sprint ticket counts, and finding totals.
3. If the contract cannot load at all, say so (the CLI exits non-zero only in that case).

Do not edit any files. Do not reimplement loading or validation.
