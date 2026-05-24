---
schema_version: 1
id: T01
title: Add a small pure add() helper with a test
kind: green
risk: low
change_class: feature
blast_radius: local
status: pending
gate: pr
gate_override: false
allowed_paths: ["src/sandbox/**"]
forbidden_paths: ["sandbox-epic/**"]
verify_commands: ["pnpm test"]
---
## Scope

Add a tiny, deterministic pure function and a focused test. This ticket exists to prove the Forge
orchestration loop on a sterile target — not to build a useful feature.

## Out of Scope

Anything outside `src/sandbox/**`. No dependency, config, or package changes.

## AI Instructions

- Create `src/sandbox/add.ts` exporting `export function add(a: number, b: number): number`.
- Create `src/sandbox/add.test.ts` with Vitest covering it.
- Run `pnpm test` and confirm it is green.

## Acceptance Criteria

- [ ] `src/sandbox/add.ts` exports a pure function `add(a: number, b: number): number`.
- [ ] `src/sandbox/add.test.ts` covers it (e.g. `add(2, 3) === 5`, and a negative case).
- [ ] `pnpm test` passes.
