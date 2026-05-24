---
description: Validate a Forge epic contract (read-only) using the Forge CLI.
argument-hint: <epic-path>
allowed-tools: Bash(forge:*), Bash(pnpm:*)
---
Thin wrapper around the **Forge CLI**. The Forge core is the source of truth — this command adds no
validation logic of its own and edits no files.

Validate the epic contract at: `$ARGUMENTS`

1. Run the Forge CLI (read-only): `forge validate $ARGUMENTS`
   - Binary resolution: use `forge` if on PATH; else the `$FORGE_BIN` env var; else, **local dev only**,
     `pnpm -C "${FORGE_REPO:-D:/Projects/forge}" forge validate $ARGUMENTS`.
2. Relay the result faithfully: `OK` or `FAILED`, and every finding (code, message, file/sprint/ticket).
3. If `FAILED`, say the contract is **not execution-ready** and summarize what must be fixed.
4. Note that default mode writes `.forge/validation-report.json` under the epic path (use `--json` for the raw report).

Do not edit any source or contract files. Do not reimplement validation.
