---
schema_version: 1
id: T01
title: Add run-report agent output source tracking
kind: green
status: pending
risk: medium
change_class: feature
blast_radius: module
depends_on: []
blocks: []
allowed_paths:
  - src/run-report/schema.ts
  - src/run-report/schema.test.ts
  - src/run-report/assemble.ts
  - src/run-report/assemble.test.ts
  - src/run-report/cli.ts
  - src/run-report/cli.test.ts
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - commands/**
  - agents/**
  - src/agents/**
  - src/orchestrator/**
  - src/cli/run.ts
  - src/cli/active-ticket.ts
  - src/guard/**
  - src/validate/**
  - src/install/**
  - src/schema/**
  - src/importer/**
  - src/run/**
  - src/fs/**
  - src/sandbox/**
  - docs/**
  - README.md
  - "*.md"
  - package.json
  - pnpm-lock.yaml
  - tsconfig.json
  - vitest.config.ts
  - .github/**
  - .claude/**
  - scripts/**
  - pilot-local/**
  - sandbox-epic/**
  - sandbox-local/**
  - .forge/**
  - "**/.forge/**"
  - "**/*.private.md"
---

# T01 — Add run-report agent output source tracking

## Scope

Add an **additive, optional** `agent_output_source` field to the Core-owned `forge-run-report/v1` artifact so a
report records *which evidence path produced each agent output*. The field is explicit orchestrator-supplied
runtime metadata — it is **not** derived from the captured outputs and **not** routed through
`OrchestratorConfirmedFacts`. The entire change lives inside `src/run-report/**`.

Three coordinated changes, all in the run-report module:

1. **Schema** (`src/run-report/schema.ts`): add an optional, strict, per-role `agent_output_source` object.
2. **Assembler** (`src/run-report/assemble.ts`): carry the field as optional `RuntimeMetadata` and propagate it
   into the report only when supplied — mirroring the existing `notes` / `commit_gate_materials` idiom.
3. **CLI** (`src/run-report/cli.ts`): accept four optional per-role flags that populate the metadata; omit the
   field entirely when no flag is supplied.

This is the right small step before the workflow-backed runner: it lets future reports distinguish not just
"what parsed," but which evidence path produced each agent output.

## Required behavior

### Enum (the trust-path label)

A three-value enum, defined once and reused for all four roles:

```
yaml_text            # captured and validated from the YAML/text path
structured_json      # captured as a structured JSON/object output, then validated by Core
workflow_core_runner # RESERVED: future workflow/core-runner deterministic capture (accepted, not emitted in 1c)
```

It is a **trust-path** label (what evidence path produced the output), deliberately collapsing "format" and
"capture authority" into one value. `workflow_core_runner` is a reserved future value: the schema accepts it so
the frozen schema is not re-opened at Phase 2, but nothing in this ticket emits it.

### Schema (`src/run-report/schema.ts`)

- Add a per-role object schema, e.g.:

  ```ts
  const AgentOutputSourceValue = z.enum([
    "yaml_text",
    "structured_json",
    "workflow_core_runner",
  ]);

  const AgentOutputSourceSchema = z
    .object({
      engineer: AgentOutputSourceValue.optional(),
      semantic_verifier: AgentOutputSourceValue.optional(),
      scope_verifier: AgentOutputSourceValue.optional(),
      pm: AgentOutputSourceValue.optional(),
    })
    .strict();
  ```

- Add to `RunReportSchema` as `agent_output_source: AgentOutputSourceSchema.optional()`.
- **Each role is individually optional; the object is `.strict()`** so unknown role keys are rejected and any
  subset of the four known roles is accepted.
- `schema` literal stays `forge-run-report/v1`. Top-level `.strict()` stays. `safety.*` and
  `final_branch_status.committed` stay `z.literal(false)` — untouched.

### Assembler (`src/run-report/assemble.ts`)

- Add an optional `agent_output_source` to `RuntimeMetadata` with the same per-role-optional shape.
- Propagate it into the candidate report with the existing conditional-spread idiom (the same pattern used for
  `notes` and `commit_gate_materials`): include the key only when the metadata is supplied; omit it entirely
  otherwise.
- The existing post-assembly `RunReportSchema.safeParse` re-validation covers the new field; the purity
  guarantee (no input mutation) is preserved.

### CLI (`forge run-report write`, `src/run-report/cli.ts`)

- Add four optional flags, each validated against the enum:

  ```
  --agent-output-source-engineer <yaml_text|structured_json|workflow_core_runner>
  --agent-output-source-semantic-verifier <…>
  --agent-output-source-scope-verifier <…>
  --agent-output-source-pm <…>
  ```

- Register the four flags in the command's `KNOWN_FLAGS`; extend `USAGE`.
- Build the `agent_output_source` metadata from whichever flags are present. If **no** flag is supplied, the
  metadata is `undefined` and the report omits the field (backward-compatible write).
- An invalid enum value on any flag → usage error (exit 2), consistent with the existing flag-validation style
  (e.g. `--gate-human-required`). Do not coerce or silently drop a bad value.
- The write fence (`<epic>/.forge/` containment) and deterministic serialization (2-space JSON, trailing
  newline, byte-identical re-writes) are unchanged.

## Out of Scope

- `src/orchestrator/**` — `OrchestratorConfirmedFacts` is **not** changed; source does not ride in the facts
  schema (that would widen scope into orchestrator territory). It rides in run-report `RuntimeMetadata`.
- `src/agents/**` — `ingest.ts`'s internal `"structured" | "yaml"` discriminator is a different concern and is
  not touched; the run-report enum is a separate human-facing provenance label.
- `commands/forge-run-ticket.md` and the charters (`agents/**`) — wiring the orchestrator to *emit* the new
  flags is a later doc/runner step, deliberately out of this ticket.
- Deriving source from `.forge/<role>-output.yaml` (a lie — the writer re-reads them as YAML regardless).
- A `forge-run-report/v1` → `v2` bump; emitting `workflow_core_runner` (Phase 2 work); the workflow runner.

## AI Instructions

- TDD: write the failing test first (RED) for each behavior, then the minimal implementation (GREEN). Do not
  weaken a test to make it pass.
- The change is additive and optional. Existing reports and existing tests must stay green; do not add the new
  field to the schema's required-field rejection loop in `schema.test.ts`.
- Reuse the existing optional-metadata idiom verbatim — model `agent_output_source` on how `notes` and
  `commit_gate_materials` already flow through `RuntimeMetadata` → conditional spread → optional schema field.
- Do not change the `schema` literal, the top-level `.strict()`, any `safety.*` literal, or
  `final_branch_status.committed`. Do not bump the schema version.
- Keep `assembleRunReport` pure (no IO; no input mutation) — the purity test must still pass.
- Keep flag parsing inside `src/run-report/cli.ts` (its own `KNOWN_FLAGS`); the router `src/cli/run.ts` is
  already wired for `run-report` and must not be touched.
- Keep wording plain; do not reword existing strings other tests assert on beyond what this change requires.

## Acceptance Criteria

1. `forge-run-report/v1` schema accepts a report **without** `agent_output_source` (backward-compatible).
2. Schema accepts `agent_output_source` populated with all four known roles.
3. Schema accepts each enum value: `yaml_text`, `structured_json`, `workflow_core_runner`.
4. Schema rejects an unknown source value (e.g. `made_up`).
5. Schema rejects an unknown role key inside `agent_output_source` (inner `.strict()`).
6. The top-level `.strict()` remains in place (an unknown top-level key is still rejected).
7. The `safety.*` `z.literal(false)` invariants remain unchanged.
8. `final_branch_status.committed` `z.literal(false)` remains unchanged.
9. `assembleRunReport` omits `agent_output_source` when it is not provided in `RuntimeMetadata`.
10. `assembleRunReport` preserves `agent_output_source` when it is provided.
11. `forge run-report write` writes `agent_output_source` when the per-role flags are explicitly provided.
12. `forge run-report write` omits `agent_output_source` when no per-role flag is provided.
13. No change to `src/orchestrator/**`.
14. No change to `src/agents/**`.
15. No change to `commands/**`.
16. `pnpm test` and `pnpm typecheck` pass.
