---
schema_version: 1
id: T01
title: Example tiny ticket (adapt me)
kind: green
risk: low
change_class: feature
blast_radius: local
status: pending
gate: pr
gate_override: false
allowed_paths: ["src/example/**"]
forbidden_paths: ["src/legacy/**", "package.json", "tsconfig.json"]
verify_commands: ["npm test"]
---
## Scope

A tiny, low-risk slice that proves the loop on your repo. Replace this with one small, well-defined unit of
work — the smallest useful change you can fence cleanly. The engineer edits only files under `allowed_paths`.

## Out of Scope

- Anything outside `allowed_paths`.
- Dependency, config, or package changes.

## AI Instructions

- Implement the smallest correct change that satisfies the Acceptance Criteria below.
- Follow TDD where it applies: write a failing test first, then the simplest code to make it pass.
- Run the `verify_commands` and confirm they are green before reporting.

## Acceptance Criteria

- [ ] <Concrete, checkable outcome #1 — name the file/function and the observable behavior.>
- [ ] <Concrete, checkable outcome #2 — include at least one edge case.>
- [ ] The `verify_commands` pass.
