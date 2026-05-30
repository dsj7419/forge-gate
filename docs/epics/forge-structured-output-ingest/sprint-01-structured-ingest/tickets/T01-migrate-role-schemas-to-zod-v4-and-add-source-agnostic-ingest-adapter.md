---
schema_version: 1
id: T01
title: Migrate role output schemas to zod/v4 and add source-agnostic ingest adapter
kind: green
risk: low
change_class: feature
blast_radius: module
status: pending
gate: pr
gate_override: false
allowed_paths:
  - "src/agents/schemas.ts"
  - "src/agents/ingest.ts"
  - "src/agents/ingest.test.ts"
  - "src/agents/parse-output.ts"
  - "src/agents/parse-output.test.ts"
  - "src/agents/index.ts"
  - "src/cli/run.ts"
  - "src/cli/run.test.ts"
forbidden_paths:
  - "src/agents/charter-output-format.test.ts"
  - "src/schema/**"
  - "src/orchestrator/**"
  - "src/run-report/**"
  - "src/guard/**"
  - "src/validate/**"
  - "src/install/**"
  - "commands/**"
  - "agents/**"
  - "docs/epics/**"
  - "README.md"
  - "package.json"
  - "pnpm-lock.yaml"
  - "tsconfig.json"
  - "vitest.config.ts"
verify_commands:
  - "pnpm test"
  - "pnpm typecheck"
---
## Scope

Build the Core foundation for the harness-era agent-output path. Two tightly-coupled changes in one
ticket:

1. **Port the role-output schemas to `zod/v4`** so they remain the single source of truth for both Core
   validation (`safeParse`) and JSON Schema generation (`z.toJSONSchema`). Discovery proved the existing
   Zod-3 schema instances cannot be converted by `zod/v4.toJSONSchema`, so the schemas themselves must be
   declared with `zod/v4`. The `zod/v4` subpath resolves under the project build with no package change
   (verified: `tsc --noEmit` exits 0; runtime confirmed).
2. **Add a source-agnostic ingest adapter** that accepts either a structured object (the future workflow
   `agent({schema})` output) or YAML text (the existing fallback) and routes both through the **same**
   role-schema validation, returning the same result shape. Add structured `parse-agent` CLI modes and a
   JSON-Schema emitter for the future workflow runner.

Core Zod validation stays authoritative on both paths. The Phase 0 spike proved structured output
constrains shape/enums/extra-keys only; refinements (PM "CORRECT requires instructions"), the
`decision_id` pattern, string non-emptiness, and numeric bounds are enforced **only** by the Zod pass.

## Out of Scope

- The workflow runner — this ticket prepares the foundation; it does not build the runner.
- Run-report source tracking — `src/run-report/**` is untouched here (Phase 1c).
- Any `package.json` / `pnpm-lock.yaml` change — `zod/v4` resolves from the installed version.
- Any edit to `src/schema/**` — `enums.ts` stays Zod 3 (shared by the contract schemas); the role
  schemas declare their own local `zod/v4` primitives.
- Any change to the existing `parse-agent` YAML modes (`--file`/`--stdin`) or to existing router
  behavior / USAGE for existing commands beyond the additive structured modes + the new `agent-schema`
  command.
- Charter (`agents/**`) or command (`commands/**`) edits; the YAML-output charter rules stay.
- `run_id` / `attempt_id`; status write-back; journal automation; hooks; `forge doctor`/`init-target`;
  auto commit / push / PR / merge; multi-ticket behavior.

## AI Instructions

- TDD per the house style: write RED tests first (ingest adapter + CLI modes + emitter) before
  implementation.
- **`src/agents/schemas.ts` → `zod/v4`:**
  - Change the import to `import { z } from "zod/v4"`. Do **not** import from `../schema/enums.js` any
    more; declare local `zod/v4` primitives in this file: `NonEmpty = z.string().trim().min(1)`,
    `TicketId = z.string().regex(/^T\d{2,}$/)`, `NonNegInt = z.number().int().nonnegative()`.
  - Keep the four role schemas, their fields, enums, unions, defaults, and `.strict()` exactly as they
    are today (`.object({...}).strict()` is valid in `zod/v4`). In `PMOutputSchema.superRefine`, change
    `z.ZodIssueCode.custom` to the string `"custom"` (the `zod/v4` form; verified). The exported
    `z.infer` types keep their names and shapes so `dispatch.ts`/`packets.ts` (type-only consumers) are
    unaffected.
  - Export a small helper for JSON Schema generation, e.g. `toRoleJsonSchema(role)` returning
    `z.toJSONSchema(SCHEMA_FOR[role])`, so the emitter has one source.
- **`src/agents/parse-output.ts`:** keep `parseAgentOutput`'s signature and behavior intact (YAML
  extraction + `safeParse`, never repair). Make the role-schema map (or a small
  `validateRole(role, data): ParseResult` helper) **exported** so the ingest adapter reuses the exact
  same validation — one source of truth, no duplicate schema logic.
- **`src/agents/ingest.ts` (new):** `ingestAgentOutput(role, source)` where
  `source = { source: "structured"; value: unknown } | { source: "yaml"; text: string }`, with per-role
  overloads mirroring `parseAgentOutput`, returning the same `ParseResult<T>`. The `yaml` branch
  delegates to `parseAgentOutput`. The `structured` branch guards that `value` is a non-null, non-array
  object (else `AGENT_OUTPUT_INVALID`, mirroring the YAML scalar rejection) then runs the same role
  `safeParse`. Never repair.
- **`src/agents/index.ts`:** add `export * from "./ingest.js"`.
- **`src/cli/run.ts`:** add `--json-file <path>` and `--json-stdin` modes to `parse-agent` (read JSON,
  `JSON.parse` to an object, call `ingestAgentOutput(role, {source:"structured", value})`; malformed JSON
  → `AGENT_OUTPUT_INVALID`, never repair). Exactly one input mode allowed (combining modes → usage error,
  exit 2). The PM `--expected-decision-id` cross-check runs after validation on **both** YAML and
  structured paths. Add a `forge agent-schema <role>` command that prints `toRoleJsonSchema(role)` as
  JSON. Update USAGE for the new modes/command only; **do not** change existing command routing, existing
  USAGE lines for other commands, or the YAML-mode behavior.
- Keep wording in code/comments plain; do not reword existing strings other commands assert on.

## Acceptance Criteria

- [ ] Existing `parse-agent` YAML behavior remains green (`--file`/`--stdin`, single fenced block, prose
      surrounding one block) — unchanged.
- [ ] Existing malformed-YAML rejection behavior remains green (`AGENT_OUTPUT_INVALID`).
- [ ] After the `zod/v4` port, the role schemas reject the same invalid objects they reject today (a
      characterization test asserts the pre-existing rejections still hold).
- [ ] Structured-object ingest accepts a valid object for each role (`engineer`, `semantic-verifier`,
      `scope-verifier`, `pm`).
- [ ] Structured-object ingest rejects invalid objects for each role (`AGENT_OUTPUT_INVALID`).
- [ ] PM `decision: CORRECT` with empty `instructions` is rejected on the structured path.
- [ ] PM malformed `decision_id` is rejected on the structured path.
- [ ] Engineer negative `adds`/`dels` are rejected on the structured path.
- [ ] `parse-agent <role> --json-file <path>` validates a structured object (exit 0 valid / 1 invalid).
- [ ] `parse-agent <role> --json-stdin` validates a structured object (exit 0 valid / 1 invalid).
- [ ] `parse-agent pm --expected-decision-id` cross-check works on the YAML path.
- [ ] `parse-agent pm --expected-decision-id` cross-check works on the structured path
      (`DECISION_ID_MISMATCH` on disagreement).
- [ ] `forge agent-schema <role>` emits a JSON Schema for each role.
- [ ] The emitted JSON Schema includes `additionalProperties: false`, `required` fields, and `enum`s
      where expected.
- [ ] The YAML path remains a working fallback and is not weakened (its tests stay green unchanged).
- [ ] No change to `src/run-report/**` (run-report schema and CLI untouched; git diff empty).
- [ ] No change to `commands/**` or `agents/**` (git diff empty).
- [ ] No change to `package.json` or `pnpm-lock.yaml` (git diff empty).
- [ ] `src/cli/run.ts` changes are limited to the additive structured `parse-agent` modes
      (`--json-file`/`--json-stdin`) and the new `agent-schema` command; existing command routing, other
      commands' USAGE, and the YAML-mode behavior are unchanged.
- [ ] `src/schema/**`, `src/orchestrator/**`, `src/guard/**`, `src/validate/**`, `src/install/**` are
      unchanged (git diff empty for each).
- [ ] `pnpm test` and `pnpm typecheck` pass.
