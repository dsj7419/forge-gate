# Phase 1c Discovery — Run-Report `agent_output_source` Tracking

> Discovery doc. Author: incoming senior engineer, 2026-05-31. Status: **for PM review — no implementation,
> no contract, no branch.** Builds on `docs/agent-output-ingest-adapter-design.md` §"Run-Report Source
> Tracking" and `docs/workflow-backed-runner-phase2-design.md` §"Evidence and Run-Report Model" (line 445).
>
> Scope of this doc: map current run-report behavior, recommend the smallest additive provenance field, and
> surface the open decisions. No production edits. Evidence cited by `path:line`; anything unverified is
> labelled.

---

## 0. Hygiene gate (pre-Phase-1c, per PM)

- `git status --porcelain --untracked-files=all` is **empty** at `main @ 9ea9f77`. Working tree clean.
- `.claude/SESSION_CONTEXT.md` is **gitignored** (`.gitignore:10`, `.claude/`), so discovery edits to it are
  not worktree changes — confirmed via `git check-ignore`.
- `docs/handoffs/` exists as an **empty directory** on disk; the 2026-05-31 engineer handoff is **not** written
  there yet, so there is **no current DIRTY_TREE**. The `.gitignore` add is **preventive**, required only
  before a self-run *if* the handoff `.md` is persisted into `docs/handoffs/` (git does not track empty dirs).
- **Recommendation:** land a tiny `chore(gitignore): ignore local handoff notes` (add `docs/handoffs/`) via the
  PR-safe flow **before the 1c self-run**, since the handoff is operative and likely to be persisted locally.
  Not a blocker for *discovery* or *contract authoring*.

---

## 1. Current run-report behavior (evidence)

**Artifact.** `forge-run-report/v1`, Core-owned, written to `<epic>/.forge/run-report.json` at the commit gate
(`PASS`) or on terminal `ESCALATE`. Runtime evidence only — never status write-back / journal / commit.

**Schema** (`src/run-report/schema.ts`):
- Top-level object is `.strict()` (`schema.ts:115,141`) — unknown keys rejected (the field-drift guard).
- `safety.*` are all `z.literal(false)` (`schema.ts:104-113`); `final_branch_status.committed` is
  `z.literal(false)` (`schema.ts:77`). This is the v1 safety thesis in code — flipping any is a `v2` bump.
- Two existing optional fields: `commit_gate_materials` and `notes` (`schema.ts:137-138`) — the precedent for
  an additive optional field.
- `parse_validation` is a strict 4-role boolean map (`schema.ts:50-57`) — the shape template for a per-role
  source map.

**Assembler** (`src/run-report/assemble.ts`) — pure, no IO:
- Consumes `AssembleInputs` = the four already-validated agent outputs + `OrchestratorConfirmedFacts` +
  `ActiveTicket` + `RuntimeMetadata` (`assemble.ts:25-33`).
- `RuntimeMetadata` (`assemble.ts:35-54`) is "runtime metadata **only the orchestrator can supply**" —
  checkpoint SHAs, guard, **optional** `commit_gate_materials`, **optional** `notes`. Optional fields are
  spread in conditionally (`assemble.ts:177-188`).
- Re-validates the assembled candidate against `RunReportSchema` as defense-in-depth (`assemble.ts:201-208`),
  then re-checks `facts.final_branch_status.committed` against the safety thesis (`assemble.ts:214-220`).

**CLI** (`src/run-report/cli.ts` — `forge run-report write <epic>`):
- Reads each agent capture from `<epic>/.forge/<role>-output.yaml` and parses via **`parseAgentOutput`
  (YAML only)** (`cli.ts:193-211`). **The writer never sees the ingest source** — it re-validates the YAML
  capture regardless of how the output was originally produced. (Implication in §6.)
- Orchestrator-only runtime metadata arrives via flags: `--checkpoint-*`, `--guard-*`, `--note` (repeatable),
  `--proposed-status-transition` / `--suggested-commit-message` / `--suggested-command`
  (`cli.ts:273-287`, `collectNotes`/`collectCommitGateMaterials` at `cli.ts:345-369`).
- Partial `commit_gate_materials` is **rejected by omission** — all-or-nothing (`cli.ts:357-362`). This is the
  precedent for all-or-none flag groups.
- Hard write fence: output only inside `<epic>/.forge/` via resolved-path containment (`cli.ts:185-189,390-401`).

**The ingest source vocabulary already exists** (`src/agents/ingest.ts:16-18`):
`AgentOutputSource = { source: "structured" } | { source: "yaml" }`. This is the *internal discriminator*; the
run-report enum is a *separate, human-facing provenance label* (mapping is trivial — see §3).

**Fixtures.** No tracked `run-report*.json` fixtures exist (`git ls-files` → none). The only `.json` report
fixtures are `validation-report.json` under `src/validate/__fixtures__/**` (unrelated). **No fixture migration
is required** — backward-compat is proven by schema tests, not by re-saving on-disk fixtures.

---

## 2. Recommended `agent_output_source` shape

**Recommendation:** whole field `.optional()`, inner four roles **all required when the field is present**.

```ts
const AgentOutputSourceSchema = z
  .object({
    engineer: AgentOutputSourceValue,
    semantic_verifier: AgentOutputSourceValue,
    scope_verifier: AgentOutputSourceValue,
    pm: AgentOutputSourceValue,
  })
  .strict();

// on RunReportSchema:
agent_output_source: AgentOutputSourceSchema.optional(),
```

**Why this shape, not inner-optional (`{ engineer?: … }`):**
- Mirrors `parse_validation` (`schema.ts:50-57`) exactly — one role-map idiom in the artifact, not two.
- "Present ⟹ complete" is a clean invariant: a run either records provenance for **all four** roles or for
  none (legacy). In practice the orchestrator ingests every role, so it always knows all four sources — there
  is no real partial state to represent. Inner-optional invites ambiguous half-populated reports for no gain.
- All-or-none maps directly onto an all-or-none CLI flag group (§6), mirroring `commit_gate_materials`.

---

## 3. Recommended enum values — **the central open decision**

There is a genuine divergence to resolve:

| Source | Proposed enum |
|---|---|
| `docs/agent-output-ingest-adapter-design.md` §Source Tracking; Phase 2 design line 446 (**accepted baseline**) | `structured_output \| yaml_fallback` (2 values) |
| Dan's current lean (handoff + kickoff) | `yaml_text \| structured_json \| workflow_core_runner` (3 values) |

**The substance:** the 2-value enum tracks **output format / ingest path** (one axis). The 3rd value
`workflow_core_runner` is on a **different axis** — *who captured/produced it* (the deterministic Phase 2
core-runner vs the LLM orchestrator), which is orthogonal to format (a core-runner still ingests *either*
structured or yaml). So the 3-value enum deliberately **collapses two axes into one label**, where
`workflow_core_runner` denotes the highest-trust path: *structured output captured by the deterministic
`forge-core-runner`* (`docs/workflow-backed-runner-phase2-design.md:362,322`).

**Recommendation: adopt Dan's 3-value enum** `yaml_text | structured_json | workflow_core_runner`, with the
semantics documented in the schema doc-comment. Reasoning:
1. **Avoids a second sensitive edit to the frozen schema.** Adding the 3rd value now is free (no producer
   emits it in 1c; the schema simply *accepts* it). Deferring it means re-opening `run-report/schema.ts` at
   Phase 2b — exactly the frozen-file edit we want to do once.
2. **Backward-compat is unaffected either way** — adding an enum member later still validates old reports, so
   3-value is not *required* for compat; the argument is purely "edit the frozen file once."
3. **Naming:** `yaml_text` / `structured_json` are more self-describing in human-facing evidence than the
   design doc's `yaml_fallback` / `structured_output`. They map trivially from the internal `ingest.ts`
   discriminator (`yaml`→`yaml_text`, `structured`→`structured_json`); `ingest.ts` itself stays untouched.

**The honest caveat to ratify:** by choosing 3 values we accept the format/capture axis-collapse. If we ever
need to separate them, a second optional field (e.g. `agent_capture_mechanism`) is itself additive — so the
collapse is reversible without a v2 bump. If Dan prefers axis-purity now, the alternative is a 2-value
`agent_output_source` (format) **+** a future optional `capture: orchestrator | core_runner`; I judge that
premature until the core-runner exists. **Decision rests with Dan.**

---

## 4. Backward-compatibility analysis

- `agent_output_source` as `.optional()` + top-level `.strict()`: `.strict()` rejects **extra** keys, not
  **missing optional** keys. Every existing report (none on disk; all produced reports to date) validates
  unchanged. Proven by a dedicated "absent field still valid" test (§7), not by fixtures.
- `schema.test.ts`'s missing-required-field loop (`schema.test.ts:87-118`) must **not** list
  `agent_output_source` (it is optional). Verified the loop is an explicit array — safe to leave as-is.
- No `forge-run-report/v1` → `v2` change. The `schema` literal stays `forge-run-report/v1` (`schema.ts:21,117`).

---

## 5. Schema-safety analysis (invariants that MUST stay)

Confirmed unchanged by an additive optional provenance field:
- `schema: z.literal("forge-run-report/v1")` — unchanged.
- Top-level `.strict()` — unchanged (the new field is a *declared* optional key, not a relaxation).
- `safety.*` all `z.literal(false)` (`schema.ts:104-113`) — untouched.
- `final_branch_status.committed: z.literal(false)` (`schema.ts:77`) — untouched.
- The assembler's post-assembly safety re-check (`assemble.ts:214-220`) — untouched.

`agent_output_source` is **read-only provenance metadata**. It records *how* an output arrived; it has zero
bearing on the PASS gate, the safety booleans, or any outward-action prevention. It cannot widen the safety
surface.

---

## 6. Assembler / CLI impact

**Plumbing decision: source rides in `RuntimeMetadata` (orchestrator-supplied at write time) + optional CLI
flags — NOT in `OrchestratorConfirmedFacts`, NOT derived.**

- **Not derived.** The writer re-parses the `.forge/*-output.yaml` captures as YAML regardless of true source
  (`cli.ts:193-211`); deriving source from them would be a *lie*. Per PM: "prefer explicit optional input."
- **Not `OrchestratorConfirmedFacts`.** Although source is semantically a per-role "confirmed fact" parallel
  to `parse_validation`, that schema lives in `src/orchestrator/packets.ts:82-104` — **outside the run-report
  scope fence** and in sensitive orchestrator territory (B2 just touched it). Threading source through facts
  would force an orchestrator edit and widen blast radius.
- **`RuntimeMetadata` is the right home.** It is by definition "runtime metadata only the orchestrator can
  supply" (`assemble.ts:35`) and already carries orchestrator-only optional metadata (`notes`,
  `commit_gate_materials`) via the identical pattern. The source is orchestrator knowledge known at write
  time, deliberately decoupled from how the writer re-validates the capture — Phase-2-agnostic. **This keeps
  the entire diff inside `src/run-report/**`.**

**Assembler change** (`assemble.ts`): add optional `agent_output_source` to `RuntimeMetadata`; propagate via
the existing conditional spread idiom (`assemble.ts:177-188`); the existing re-validation (`assemble.ts:201`)
already covers the new field. Purity test (`assemble.test.ts:317-333`) extends to include it.

**CLI change** (`cli.ts`): add four optional flags `--source-engineer`, `--source-semantic`, `--source-scope`,
`--source-pm`, each validated against the enum. **All-or-none**: supply all four → include the field; supply
none → omit it; supply a partial subset or a bad enum → **usage error (exit 2)**, mirroring the
`commit_gate_materials` all-or-nothing precedent (`cli.ts:357-362`). Add the four flags to `KNOWN_FLAGS`
(`cli.ts:60-82`). This is a **narrow** CLI addition (4 sibling optional flags), consistent with the existing
`--note` / `--suggested-command` surface — not the "broad CLI surface" the PM cautioned against.

---

## 7. Test plan (TDD — RED first)

**`schema.test.ts`:**
- accepts the VALID fixture **with** `agent_output_source` populated for all four roles — one case per enum
  value (`yaml_text`, `structured_json`, `workflow_core_runner`).
- accepts the VALID fixture **without** `agent_output_source` (backward-compat — the load-bearing test).
- rejects an unknown enum value (e.g. `"made_up"`).
- rejects a partial map (missing one role) when the field is present (inner `.strict()` + required roles).
- rejects an unknown inner key (inner `.strict()`).
- existing strict/​safety/​missing-required tests stay green (the new field is not in the required loop).

**`assemble.test.ts`:**
- propagates `agent_output_source` into the report when supplied in `RuntimeMetadata`.
- omits it (no top-level key) when absent — mirroring the `notes`/`commit_gate_materials` omission tests.
- purity test covers the new optional input.

**`cli.test.ts`:**
- all four `--source-*` flags → report carries the field.
- no `--source-*` flags → report has no `agent_output_source` (backward-compat write).
- partial subset (e.g. only `--source-engineer`) → usage error (exit 2).
- bad enum value → usage error (exit 2).
- determinism preserved (byte-identical re-write).

---

## 8. Scope proposal

**`allowed_paths`** (the run-report module only):
```
src/run-report/schema.ts
src/run-report/schema.test.ts
src/run-report/assemble.ts
src/run-report/assemble.test.ts
src/run-report/cli.ts
src/run-report/cli.test.ts
```

**`forbidden_paths`** (explicitly fence off the tempting-but-wrong routes + the broad set):
```
src/orchestrator/**        # forces RuntimeMetadata route, not the facts-schema route
src/agents/**              # ingest.ts/schemas.ts stay untouched
src/cli/run.ts             # router unchanged (run-report subcommand already wired)
src/guard/**
src/validate/**
src/install/**
commands/**
agents/**
package.json
pnpm-lock.yaml
tsconfig.json
vitest.config.ts
README.md
```

**Docs:** prefer **no docs in `allowed_paths`**. The design docs already describe the field accurately; the
only doc nit is reconciling their 2-value enum to the ratified 3-value — that is better handled as a separate
tiny `docs(...)` PR *after* Dan ratifies the enum, not bundled into the sensitive schema ticket. (Flag, not a
scope ask.)

**`protected_paths`:** inherits the orchestrator default (`docs/governance/**`, `**/manifest.yaml`,
`**/epic.yaml`, journals/decisions — `packets.ts:16-22`). No ticket-specific additions needed.

---

## 9. Risk / change_class / blast_radius / gate

| Attribute | Proposed | Rationale |
|---|---|---|
| `change_class` | **`feature`** | Additive capability. **Not** `migration`/`security`/`infra`/`dependency` — those auto-escalate (`src/validate/escalation.ts`). |
| `risk` | **`low`** (arguably `medium`) | Additive optional field; touches the frozen schema but cannot weaken safety. `medium` is defensible purely for the frozen-file sensitivity — PM's call. |
| `blast_radius` | **small / module-local** | One module (`src/run-report/**`); no consumer outside it reads the new field in 1c. |
| `gate` | **`pr`** | Matches every prior Core ticket. |

**⚠️ Escalation-matcher caution** (`escalation-keyword-false-positive` memory, `src/validate/escalation.ts`):
the matcher is negation-blind and scans title + body + paths + verify_commands for `auth`, `secrets?`, `\.env`,
`production`, `prod`, `delete`, `remove`, `rm -rf`, `migrations?`. The ticket prose must avoid these — e.g. do
not write "migration", "production"; "source tracking" / "provenance field" are clean. **Confirm
`gate: pr, no escalation` via `forge run --dry-run` at contract time before authoring is final.**

---

## 10. Open decisions for Dan

1. **Enum (the big one):** ratify the **3-value** `yaml_text | structured_json | workflow_core_runner`
   (my recommendation, §3) accepting the documented format/capture axis-collapse — **or** keep the design
   doc's 2-value `structured_output | yaml_fallback` and defer the runner value to Phase 2b. This also fixes
   the *names* (`*_text`/`*_json` vs `*_fallback`/`*_output`).
2. **Field shape:** confirm whole-field-optional + all-four-roles-required-when-present (§2), vs inner-optional.
3. **Plumbing:** confirm `RuntimeMetadata` + 4 optional CLI flags (§6), vs routing through
   `OrchestratorConfirmedFacts` (would widen scope into `src/orchestrator/**`).
4. **`risk`:** `low` vs `medium` for the frozen-schema sensitivity (§9).
5. **Docs reconciliation:** fold the 2→3 enum doc fix into 1c (needs a doc in scope) or a separate tiny docs PR
   (my lean: separate).
6. **Hygiene timing:** approve the `docs/handoffs/` `.gitignore` PR before the 1c self-run (§0)?

---

## 11. Recommendation

The next unit is correctly scoped and low-risk. **Do not author the contract until Dan ratifies the §10
decisions** — chiefly the enum. Once ratified, the contract is small: an additive `.optional()`
`agent_output_source` on `forge-run-report/v1`, plumbed via `RuntimeMetadata` + four optional CLI flags, with
`src/run-report/**` in scope and `safety.*`/`committed` literals untouched. No `v2` bump. TDD, RED first,
proven on a frozen-`dist/` self-run that stops at the commit gate.
