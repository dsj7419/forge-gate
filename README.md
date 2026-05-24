# Forge Core

Deterministic core for agent-driven epic execution. **CLI-first and runtime-agnostic** — it runs
from a plain terminal and is consumed by Claude Code command wrappers, never the other way around.

> Design spec: `../apitest/docs/superpowers/specs/2026-05-23-agent-epic-pipeline-design.md`

## Status

**Milestone 1 complete:** the read-only validator and its CLI.

The validation pipeline is `load → integrity → readiness → report`, exposed as
`validateContract(epicPath): ValidationReport` and wrapped by the `forge` CLI. No source or epic
files are ever modified during validation. Hooks, agents, the importer, and execution are not built yet.

## Commands

```
forge validate <epic-path>          Validate a contract. Prints a human-readable summary and
                                     writes .forge/validation-report.json. Exit 0 if ok, 1 if not.
forge validate <epic-path> --json   Print the full ValidationReport as JSON. Writes no artifact.
forge status <epic-path>            Summarize epic id, sprint ids, ticket counts, finding totals.
                                     Exit 0 normally; exit 1 only if the contract cannot load at all.

forge run <epic-path> --dry-run     Execution preview (read-only): validate, then report the next ready
                                     ticket, dependency reasoning, paths, verify commands, effective gate,
                                     proposed branch, and the agent chain that WOULD run. Changes nothing.
                                     Exit 0 if a ticket is ready, 1 if blocked. (--json for the raw report.)

forge import --from-existing <legacy-sprint-path> --out <epic-root> --dry-run
                                     Plan an import: list canonical target files and flag ambiguity.
                                     Read-only; writes nothing.
forge import --from-existing <legacy-sprint-path> --out <epic-root>
                                     Live import: generate the canonical contract and validate it.
forge import ... --json              Emit the import plan / result as JSON.
```

### Importing legacy sprints

`forge import` normalizes a legacy (pre-Forge) sprint folder into the canonical contract.

- **Overwrite policy:** the output directory must be empty or non-existent. A non-empty `--out`
  is refused with `IMPORT_OUTPUT_EXISTS`. There is **no `--force`** in v1.
- The legacy source folder is never modified. Prose is preserved verbatim in the generated
  `SPRINT.md`, `DECISIONS.md`, and ticket bodies. A self-contained `.forge/import-report.json`
  is written.
- **Import-draft semantics:** when a required canonical field (e.g. `risk`, `change_class`,
  `blast_radius`) is ambiguous in the legacy source, the importer writes a `TODO` placeholder
  **rather than inventing a value**. Such a contract is a *human-completion draft*: `validateContract`
  intentionally flags those fields, the command prints "requires human completion before execution,"
  and exits non-zero. Complete the `TODO`s, then `forge validate` until the contract is clean.

### Exit codes

| Code | Meaning |
|------|---------|
| `0`  | success (`validate`: report ok; `status`: contract loaded) |
| `1`  | validation/status failure (findings, or contract could not load; also an artifact-write failure) |
| `2`  | usage error (missing path, unknown flag) |

### Artifact behavior

- `forge validate <epic-path>` (default mode) writes `.forge/validation-report.json` under the epic path.
- `forge validate <epic-path> --json` prints JSON to stdout and writes **no** artifact.
- `.forge/` is gitignored. If the artifact write fails, validation output is still printed, a clear
  message goes to stderr, and the process exits non-zero.

## Develop

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build                                  # emit dist/
pnpm forge validate <epic-path>             # dev run via tsx
node dist/cli.js validate <epic-path>       # run the built binary
```

## Claude Code wrappers (convenience surface)

**Forge Core (this CLI) is the source of truth.** The Claude Code slash commands are *thin* wrappers
that shell out to the `forge` CLI and summarize its output — they add no logic, never edit source, and
never invent metadata.

| Command | Runs |
|---|---|
| `/forge-validate <epic-path>` | `forge validate <epic-path>` |
| `/forge-status <epic-path>` | `forge status <epic-path>` |
| `/forge-import --from-existing <legacy> --out <epic-root> [--dry-run]` | `forge import ...` |
| `/forge-run-dry-run <epic-path>` | `forge run <epic-path> --dry-run` |

Canonical wrapper sources live in `commands/`. Install them into `~/.claude/commands/` with:

```bash
pnpm install-commands
```

**Binary resolution.** Each wrapper invokes a single deterministic command —
`node "${FORGE_REPO:-<forge-repo>}/scripts/run-forge-cli.mjs" <subcommand> $ARGUMENTS` — so the tool
allowlist (`Bash(node:*)`) matches cleanly without a compound shell snippet. The resolver script picks the
CLI in order: `$FORGE_BIN` (overrides PATH, pins a build) → `forge` on `PATH` → local-dev `pnpm -C <repo> forge`.
To put `forge` on `PATH`: `pnpm build` then `pnpm link --global`. `FORGE_REPO` defaults to the **local-dev**
repo path — set it or link the CLI globally for real use.

### Wrapper smoke checklist (manual, inside Claude Code)

Install once, then run the slash commands **inside Claude Code** (they are not shell commands; set
`FORGE_REPO` in the environment if `forge` is not linked globally):

```bash
pnpm install-commands
# then, inside Claude Code (with FORGE_REPO exported if forge is not on PATH):
/forge-validate src/validate/__fixtures__/valid-epic
/forge-run-dry-run src/validate/__fixtures__/valid-epic
```

Expected:
- `/forge-validate <fixture>` → `OK`/`FAILED` + findings.
- `/forge-status <fixture>` → epic / sprint ids / ticket counts.
- `/forge-import --from-existing <legacy> --out <tmp> --dry-run` → planned target files + ambiguity findings; nothing written.
- `/forge-run-dry-run <fixture>` → next ready ticket + "No files changed"; an invalid contract shows `BLOCKED`.
- No wrapper edits source or contract files.

## Agent charters (definitions only — no live dispatch yet)

The four Forge subagent roles are defined as Claude Code subagent charters in `agents/` (installed to
`~/.claude/agents/` by `pnpm install-commands`). They are **declarations of the human/agent contract** — nothing
dispatches them until the orchestrator is built.

| Charter | Role | Edits code? | Decides? |
|---|---|---|---|
| `forge-engineer` | Implements one ticket, TDD, within its allowed paths | yes (allowed paths only) | no |
| `forge-semantic-verifier` | Verifies acceptance is genuinely met vs repo reality | no (read-only) | verdict only |
| `forge-scope-verifier` | Verifies the diff stays inside the path fences | no (read-only) | verdict only |
| `forge-pm` | Synthesizes outputs, decides PASS / CORRECT / ESCALATE | no | yes |

Each charter specifies its role, inputs, the governance docs it must read, what it must **not** do, a
**structured YAML output schema**, escalation behavior, and **anti-theater rules** (verifiers must cite concrete
evidence; "looks good" is invalid; the PM may not PASS over a REJECT without a recorded override + human escalation).

## Principles

- The core is real, typed, unit-tested code — never prompt logic.
- `forge validate` is a hard precondition for any future execution and is **read-only**.
- One responsibility per module (`schema`, `validate/{load,integrity,readiness,findings}`, `cli`).
- Findings use a single stable shape (`ValidationFinding`) with canonical codes and epic-relative paths.
