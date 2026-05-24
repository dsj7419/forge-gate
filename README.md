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
```

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

## Principles

- The core is real, typed, unit-tested code — never prompt logic.
- `forge validate` is a hard precondition for any future execution and is **read-only**.
- One responsibility per module (`schema`, `validate/{load,integrity,readiness,findings}`, `cli`).
- Findings use a single stable shape (`ValidationFinding`) with canonical codes and epic-relative paths.
