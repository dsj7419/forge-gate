---
schema_version: 1
id: T01
title: Fix engineer-packet section label
kind: green
risk: low
change_class: refactor
blast_radius: local
status: pending
gate: pr
gate_override: false
allowed_paths: ["src/orchestrator/dispatch.ts", "src/orchestrator/dispatch.test.ts"]
forbidden_paths: ["docs/**", "commands/**", "agents/**", "package.json", "pnpm-lock.yaml", "src/cli/**", "src/validate/**", "src/run/**", "src/importer/**", "sandbox-epic/**"]
verify_commands: ["pnpm test src/orchestrator/dispatch.test.ts", "pnpm typecheck"]
---
## Scope

`renderContext` for the engineer role in `src/orchestrator/dispatch.ts` labels the ticket section
`## Ticket (front-matter + body)`, but it renders only the ticket **body** (`p.ticket_body`). The YAML
front-matter is conveyed elsewhere (packet header / common fields / role task), not in that section.
Correct the label so the prompt honestly describes its content. This is prompt-text clarity only — no
behavior change and no change to what data the packet carries.

## Out of Scope

- Any change to packet contents or packet generation (`src/orchestrator/packets.ts`).
- Any file outside `allowed_paths`.
- Dependency, config, or package changes.

## AI Instructions

- In `src/orchestrator/dispatch.ts`, change the engineer ticket-section header so it no longer claims
  "front-matter + body" while rendering only the body (e.g. `## Ticket (body)`).
- Follow TDD: first add or adjust a test in `src/orchestrator/dispatch.test.ts` that asserts the engineer
  prompt uses the accurate header (and does **not** contain the old "front-matter + body" label); confirm
  it fails against the current code; then make the one-line label change so it passes.
- Preserve every existing assertion (do not weaken or drop any). Keep all existing prompt content intact
  (ticket body, Acceptance Criteria, AI Instructions, verify commands, and the cwd-discipline statement).
- Run the verify commands and confirm both are green before reporting.

## Acceptance Criteria

- [ ] The engineer dispatch prompt no longer labels the ticket section as "front-matter + body" while it
      renders only the body; the header accurately describes the rendered content.
- [ ] The engineer prompt still contains the ticket body, its Acceptance Criteria, the AI Instructions,
      the verify commands, and the cwd-discipline statement.
- [ ] `src/orchestrator/dispatch.test.ts` contains an assertion for the corrected header that would have
      failed before this change.
- [ ] `pnpm test src/orchestrator/dispatch.test.ts` passes.
- [ ] `pnpm typecheck` passes.
