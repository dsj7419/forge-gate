# Forge Core

Deterministic core for agent-driven epic execution. **CLI-first and runtime-agnostic** — it runs
from a plain terminal and is consumed by Claude Code command wrappers, never the other way around.

> Design spec: `../apitest/docs/superpowers/specs/2026-05-23-agent-epic-pipeline-design.md`

## Status

Milestone 1 (in progress): schema + `forge validate` + minimal `forge status` + tests.
No hooks, agents, importer, or live `forge run` yet.

## Develop

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm forge validate <epic-path>   # dev run via tsx
```

## Principles

- The core is real, typed, unit-tested code — never prompt logic.
- `forge validate` is a hard precondition for any future execution and is **read-only**.
- One responsibility per module (`schema`, `validate`, `fs`, `report`, `errors`, `cli`).
