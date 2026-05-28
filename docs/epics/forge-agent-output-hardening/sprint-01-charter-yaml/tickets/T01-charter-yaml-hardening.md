---
schema_version: 1
id: T01
title: Harden agent charter YAML-output guidance
kind: green
risk: low
change_class: test
blast_radius: local
status: pending
gate: pr
gate_override: false
allowed_paths: ["agents/forge-engineer.md", "agents/forge-semantic-verifier.md", "agents/forge-scope-verifier.md", "agents/forge-pm.md", "src/agents/charter-output-format.test.ts", "src/agents/parse-output.test.ts"]
forbidden_paths: ["src/agents/parse-output.ts", "src/agents/schemas.ts", "src/agents/index.ts", "src/schema/**", "src/cli/**", "src/orchestrator/**", "commands/**", "package.json", "pnpm-lock.yaml", "tsconfig.json", "vitest.config.ts", "docs/epics/**"]
verify_commands: ["pnpm test", "pnpm typecheck"]
---
## Scope

Harden the four agent charters so they guide agents toward schema-valid YAML, closing the flow-mapping
fragility that caused an `AGENT_OUTPUT_INVALID` halt in a recent run (an `acceptance_checked` entry written as
an inline flow mapping with an unquoted, comma-bearing string split into spurious keys). Each charter's
`## Output` section gains explicit YAML-output rules and a block-style example. Add a regression test that
enforces the charter format, plus a characterization test pinning that the fragile flow-style-with-unquoted-comma
shape is still rejected by Core. **Core's parser and schemas are correct and are NOT changed** — the fix is
entirely in the charter templates plus tests.

## Out of Scope

- Any change to `src/agents/parse-output.ts`, `src/agents/schemas.ts`, or `src/agents/index.ts` — the parser
  and schemas are correct; do **not** loosen them. Core stays strict.
- Improving parser error messages (a separate future item).
- Hooks, doctor, init-target, installer/plugin, status write-back, journal automation, multi-ticket behavior.
- Any change outside the four charter docs and the two allowed test files.

## AI Instructions

- In each of the four charters' `## Output` sections, add an explicit YAML-output rule set:
  - Use block-style YAML mappings (one key per line).
  - Do **not** use inline flow mappings (`{ ... }`) for object lists.
  - Quote every string value that contains a comma, colon, slash, bracket, brace, parenthesis, or `#`.
  - Emit exactly one YAML object (plain YAML or inside one ```yaml fenced block), with no prose before or after.
- Convert each charter's example to **block style**, especially the list-of-object fields (engineer
  `files_changed` / `commands_run`; semantic-verifier `acceptance_checked` / `findings`; PM `instructions`).
  Replace inline `- { key: ..., ... }` entries with block entries.
- Keep the existing field names, enums, and required-field shape **exactly** — only the YAML *style* and the
  added rule text change. Do not alter which fields are required.
- Add the tests below. Run `pnpm test` and `pnpm typecheck` and confirm both are green before reporting.

## Acceptance Criteria

- [ ] Each of the four charters (`forge-engineer`, `forge-semantic-verifier`, `forge-scope-verifier`,
      `forge-pm`) contains the YAML-output rule set: block-style mappings; no inline flow mappings for object
      lists; quote punctuation-bearing strings; exactly one YAML object; no surrounding prose.
- [ ] Each charter's `## Output` example uses block-style entries for its object-list fields — no `- { ... }`
      inline flow mappings remain in any charter example.
- [ ] The semantic-verifier example shows `acceptance_checked` entries in block style (`- id:` / `status:` /
      `evidence:` on separate lines) with quoted string values.
- [ ] A new test `src/agents/charter-output-format.test.ts` reads all four `agents/forge-*.md` files and
      asserts: (a) each contains the block-style / quoting rule text; (b) each charter's fenced YAML example
      contains no inline flow mapping for an object-list field.
- [ ] `src/agents/parse-output.test.ts` gains a characterization test proving that a flow-style mapping with an
      unquoted, comma-bearing scalar yields `AGENT_OUTPUT_INVALID` (Core remains strict; invalid output is
      rejected, never repaired).
- [ ] `src/agents/parse-output.ts`, `src/agents/schemas.ts`, and `src/agents/index.ts` are unchanged.
- [ ] `pnpm test` and `pnpm typecheck` pass.
