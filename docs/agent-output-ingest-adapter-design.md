# Agent Output Ingest Adapter Design

> Phase 1 design doc. Author: senior engineer, 2026-05-29. Status: **for PM review — no implementation.**
> Builds on `docs/harness-structured-output-discovery.md` and the Phase 0 spike
> (`pilot-local/structured-output-spike/FINDINGS.md`, gitignored). Target surface per PM:
> **workflow `agent({schema})`**, not raw Messages API.
>
> No epic/branch/commit/PR, no production source/schema/charter/command edits, no YAML removal, no
> `package.json`/lockfile change. Evidence cited by path; unverified items labelled.

---

## Executive Summary

Introduce a **source-agnostic agent-output ingest adapter**: ForgeGate accepts either a **structured
object** (from the workflow `agent({schema})` path) or **YAML text** (the existing slash-command
fallback) and funnels **both through the same authoritative Core Zod validation**. YAML stays as the
fallback; structured output becomes the preferred harness-era path.

Two design decisions are settled by evidence:
- **Schema source of truth → Option A** (migrate only `src/agents/schemas.ts` to `zod/v4`). The ripple is
  contained: the only *runtime* consumer of the schema objects is `parse-output.ts` (`.safeParse` works
  on `zod/v4`); `dispatch.ts`/`packets.ts` use `import type` only. `enums.ts` and all contract schemas
  stay Zod 3. Option B (parallel schemas) is rejected — it duplicates the role *contracts*, the exact
  drift ForgeGate exists to prevent.
- **Core Zod re-validation stays mandatory and authoritative** — the Phase 0 spike proved the runtime
  accepts objects Core rejects (CORRECT+empty-instructions, malformed `decision_id`, negative counts,
  empty required strings). The adapter changes *how output arrives*, never *what is enforced*.

The adapter is additive: a new `src/agents/ingest.ts` wraps the unchanged `parse-output.ts`. The CLI gains
`--json-file`/`--json-stdin` modes and a `forge agent-schema <role>` emitter; YAML modes and the PM
decision-id cross-check are untouched.

---

## Goals
1. Accept structured objects OR YAML, both validated by the same Core Zod schemas.
2. Make `src/agents/schemas.ts` the single source of truth for **both** `safeParse` (Core validation) and
   `z.toJSONSchema` (the schema handed to `agent({schema})`).
3. Keep YAML fully working as fallback; do not weaken `parse-output.ts` or its tests.
4. Preserve the PM decision-id cross-check on both paths.
5. Provide the workflow runner a way to fetch each role's JSON Schema.

## Non-Goals
- Implementation (design only).
- Building the workflow runner (Phase 2).
- A repo-wide Zod 3→4 migration (only `schemas.ts` moves).
- A schema-sanitization pass (spike showed the workflow path tolerated `minLength`; revisit only if we
  later target the raw Messages-API surface).
- Removing YAML, editing charters/commands, or changing `/forge-run-ticket`.
- `run_id`/`attempt_id`, status write-back, journal automation, auto-anything, multi-ticket.

---

## Current Agent-Output Path

`agent emits YAML text → forge parse-agent → parseAgentOutput → Zod safeParse`:
- `src/agents/parse-output.ts` — extracts a single ```yaml fenced block (or whole text), `parseYaml`,
  then `SCHEMAS[role].safeParse`; rejects malformed/prose-only as `AGENT_OUTPUT_INVALID`, never repairs
  (`:48-73`).
- `src/agents/schemas.ts` — the four role Zod schemas (Zod 3), using `NonEmptyStringSchema`/`TicketIdSchema`
  from `src/schema/enums.ts`.
- `src/cli/run.ts:228-279` — `forge parse-agent <role> (--file|--stdin) [--expected-decision-id]`; the PM
  cross-check compares the emitted `decision_id` to the Core-pinned one (`:256-276`).
- The orchestrator captures raw output to `.forge/<role>-output.yaml` and runs `parse-agent`
  (`commands/forge-run-ticket.md` steps 5/8/9). `run-report write` re-reads those `.yaml` files.

## Structured-Output Target Path

`workflow agent({schema}) → validated object → forge parse-agent (structured mode) → same Zod safeParse`:
- Workflow runner fetches the role JSON Schema (`forge agent-schema <role>`), passes it to
  `agent(prompt, {schema})`; the runtime returns a validated object (spike-confirmed: enums coerced,
  extra keys dropped).
- The object is written to a file by a workflow agent (the script has no fs), then a `core-runner` agent
  runs `forge parse-agent <role> --json-file <path>` → **Core's authoritative Zod re-validation** (the
  only place superRefine / `minLength` / `pattern` / numeric bounds are enforced — spike-proven).
- The PM cross-check runs identically on the structured object's `decision_id`.

---

## Claude Code Substrate Review

> Standing rule (from 2026-05-29): every ForgeGate design classifies each capability to the right
> Claude Code primitive, and keeps ForgeGate to **deterministic governance, validation, provenance, and
> human gates** — the layer the primitives do not provide. World-class bar: *compose with Claude Code's
> best primitives; ForgeGate adds the governance they lack.*

| Capability in this design | Substrate | Rationale |
|---|---|---|
| Orchestrating the run (dispatch roles, hold sequence + correction loop, fetch schemas, request outputs, invoke Core) | **Dynamic workflow** (Phase 2 runner) | Execution substrate; first-party multi-agent orchestration. **Not the trust boundary.** The ingest adapter is invoked *by* the workflow but is Core. |
| Engineer/verifier/PM **emission** | **Structured output** (`agent({schema})`) | Returns a validated object; replaces "emit YAML correctly" prompting. Spike-confirmed (enums coerced, extra keys dropped). YAML stays fallback. |
| Role isolation **and tool scope** | **Custom subagents / agent types** | `forge-engineer`, `forge-semantic-verifier`, `forge-scope-verifier`, `forge-pm`, **`forge-core-runner`**. Spike finding: no per-`agent()` tool param → tool denial lives at **agentType + session allowlist**. `forge-core-runner` runs approved Forge Core / read-only git and returns structured command results; allowed `node …/dist/cli.js …` + read-only git, **denied `git push`/`gh`/destructive** — the bridge that lets a workflow invoke Core without granting outward capability. |
| Role schemas, **ingest adapter**, `parse-agent` (never-repair), `agent-schema` emitter, **authoritative Zod re-validation**, PM decision-id cross-check, run-report, guard, decision ledger, gate | **Forge Core** | The deterministic governance/validation/provenance layer. None of it moves to a primitive — it is exactly what the primitives do **not** provide. The spike proved Core rejects objects the runtime accepts. |
| Operating guidance (`/forge-run-ticket` procedure, adoption guide) | **Skill** | Reusable guidance only — **never a safety boundary.** Enforcement is Core + structured output, not skill prose. |
| Command-policy / formatting enforcement | **Hook — deferred** | Could later enforce policy, but not until the workflow-runner trust model is settled. Do not introduce now. |
| Headless productization of the same pattern | **Agent SDK / headless — future** | Same structured-output + Zod-revalidate pattern applies headless; a later distribution path, not next. |

**Net for this design:** the adapter, schemas, CLI, cross-check, and re-validation are **Forge Core**;
the *delivery* of structured output is a Claude Code **structured-output + agent-type** concern consumed
by a Claude Code **dynamic workflow** in Phase 2; YAML stays as the fallback skill path. Nothing here is
a hook or depends on the Agent SDK.

---

## Schema Source-of-Truth Decision

**Recommendation: Option A — migrate `src/agents/schemas.ts` to `zod/v4`.**

Evidence (this session's grep): the only **runtime** importer of the schema objects is
`src/agents/parse-output.ts` (same directory; `SCHEMAS[role].safeParse`). `src/orchestrator/dispatch.ts:6`
and `src/orchestrator/packets.ts:5` import **types only** (`import type { EngineerOutput, … }`) — erased
at compile, structurally identical regardless of Zod version. So the migration's runtime blast radius is
`schemas.ts` + `parse-output.ts` (whose `.safeParse` already works on `zod/v4`).

The one coupling: `schemas.ts` borrows `NonEmptyStringSchema`/`TicketIdSchema` from the shared Zod-3
`src/schema/enums.ts` (also used by importer, decisions-ledger, dry-run, run-report/schema). A `zod/v4`
object **cannot** compose a Zod-3 sub-schema (same incompatibility that made the spike's real-schema
conversion fail). So Option A declares **three local `zod/v4` primitives in `schemas.ts`** —
`NonEmptyString = z4.string().trim().min(1)`, `TicketId = z4.string().regex(/^T\d{2,}$/)`,
`NonNegInt = z4.number().int().nonnegative()` — and leaves `enums.ts` (and every contract schema) Zod 3.

## Zod 4 Migration Options

| | Option A: migrate `schemas.ts` to zod/v4 | Option B: parallel zod/v4 JSON-schema-only schemas |
|---|---|---|
| **Pros** | Single source of truth for `safeParse` + `toJSONSchema`; zero role-contract drift; smallest footprint | No change to existing `schemas.ts`/Zod-3 path |
| **Cons** | Dual Zod runtimes in-process; 3 primitives duplicated; Zod-4 infer/message deltas to verify | **Two definitions of every role contract** → drift between the validator and the schema generator — the precise failure ForgeGate prevents |
| **Files touched (prod)** | `src/agents/schemas.ts` only (z import → `zod/v4` + 3 local primitives). `parse-output.ts` unchanged (`.safeParse` works); `dispatch.ts`/`packets.ts` unchanged (type-only) | new `src/agents/schemas.jsonschema.ts` + wiring |
| **Risk** | Low–Med (dual-runtime, contained) | Med–High (silent contract drift) |
| **Test burden** | Re-run suite; `parse-output.test.ts` asserts **no exact Zod messages** (verified) so message deltas don't break; pin the 3 duplicated primitives with a small equivalence test | Must test both schema sets stay in sync forever |
| **Drift risk** | Only 2 primitives (`NonEmptyString`/`TicketId`) — pin with a test | **The role contracts themselves** |

**Recommendation: Option A.** Containment is proven; the only residual drift surface is two trivially-
pinnable primitives, versus Option B duplicating the contracts.

---

## Adapter API Design

New module `src/agents/ingest.ts` (keeps `parse-output.ts` intact and wraps it):

```ts
export type AgentOutputSource =
  | { source: "structured"; value: unknown }   // from workflow agent({schema})
  | { source: "yaml"; text: string };           // existing fallback

// Role-typed overloads mirror parseAgentOutput; returns the SAME ParseResult<T>.
export function ingestAgentOutput(role: "engineer", src: AgentOutputSource): ParseResult<EngineerOutput>;
// …semantic-verifier / scope-verifier / pm overloads…
export function ingestAgentOutput(role: AgentRole, src: AgentOutputSource): ParseResult<unknown>;
```

Behavior:
- `source: "yaml"` → delegates to the existing `parseAgentOutput(role, text)` **unchanged** (fence
  extraction + `parseYaml` + Zod). YAML semantics and tests are untouched.
- `source: "structured"` → guard that `value` is a non-null non-array object (else `AGENT_OUTPUT_INVALID`,
  mirroring the YAML scalar-rejection), then `SCHEMAS[role].safeParse(value)` directly — **no YAML, no
  fence logic, never repair**. Same `AGENT_OUTPUT_INVALID` failure shape.

**Refinement to the proposed shape:** keep `value: unknown` (untrusted — the runtime guarantees the
JSON-Schema subset, not the Zod invariants). Add the per-role overloads for type-safe call sites. The
adapter returns the identical `ParseResult<T>` so every downstream consumer is source-agnostic and
unchanged.

**Existing parser decision:** keep `parse-output.ts` exactly as-is; `ingest.ts` is a thin new front door
that owns source-routing and shares the one `SCHEMAS` map + the same never-repair contract. (Matches the
PM's stated preference; verified safe because `parse-output.ts` already isolates the Zod step.)

---

## CLI Surface Design

Extend `forge parse-agent <role>` with a structured mode; YAML modes unchanged:

```
forge parse-agent <role> --file <path>        # YAML (existing)
forge parse-agent <role> --stdin              # YAML (existing)
forge parse-agent <role> --json-file <path>   # NEW: structured object (JSON)
forge parse-agent <role> --json-stdin         # NEW: structured object (JSON)
  [--expected-decision-id <D-NNN>]            # pm only — applies to ALL modes
```
- Exactly one input mode required; combining modes → usage error (exit 2).
- `--json-file`/`--json-stdin` read JSON, `JSON.parse` to an object, call `ingestAgentOutput(role,
  {source:"structured", value})`. Malformed JSON → `AGENT_OUTPUT_INVALID` (never repair).
- The PM `--expected-decision-id` cross-check runs **after** validation on **both** paths (it operates on
  the validated object's `decision_id`, which is source-independent).

New emitter command:
```
forge agent-schema <role> [--json]   # prints z.toJSONSchema(SCHEMAS[role])
```
The workflow runner (a `core-runner` agent) calls this to obtain the JSON Schema to pass to
`agent({schema})`. No sanitization pass for now (workflow surface tolerated the emitted constraints).

**JSON Schema generation — recommendation:** a `forge agent-schema <role>` CLI command (consumable by
the workflow) **plus snapshot tests** of each emitted schema (drift/regression guard). Reject "library
export only" (the workflow needs a CLI to call via core-runner) and "snapshots only" (the runner needs a
live emitter).

---

## PM Decision-ID Cross-Check

**Preserved verbatim, both paths.** The cross-check (`cli/run.ts:256-276`) compares the validated PM
object's `decision_id` against `--expected-decision-id`; `DECISION_ID_MISMATCH` on disagreement. It is
source-agnostic — it runs on the object after `ingestAgentOutput` regardless of YAML or structured origin.
Structured output reduces *formatting* fragility; it does not touch provenance. The Core-pinned-and-echoed
contract (`renderAssignedDecisionId` → PM echoes → cross-check) is unchanged.

---

## Run-Report Source Tracking

**Design now; implement as a separate, explicitly-scoped step — NOT bundled with the adapter.**

Proposed additive field on `forge-run-report/v1`:
```
agent_output_source:
  engineer: structured_output | yaml_fallback
  semantic_verifier: structured_output | yaml_fallback
  scope_verifier: structured_output | yaml_fallback
  pm: structured_output | yaml_fallback
```
**Risk call-out (per PM instruction):** `RunReportSchema` is `.strict()` (`src/run-report/schema.ts:115`),
so adding any new key is a schema change — an unknown `agent_output_source` would currently be **rejected**.
Adding it as `.optional()` is backward-compatible (existing reports without it still validate), but it
**does modify `forge-run-report/v1`** and touches `src/run-report/schema.ts` (a sensitive, deliberately-
frozen file). Therefore it must be its **own small Core ticket** with `run-report/schema.ts` +
`schema.test.ts` explicitly in `allowed_paths`, plus the assembler wiring — separate from the adapter
ticket. **Recommendation:** additive-optional field, separate Phase-1c ticket, after the adapter proves
out. Do not fold it into the adapter ticket.

---

## Test Strategy

New `src/agents/ingest.test.ts`:
- structured object **valid** (each role) → `ok:true`, typed data.
- structured object **invalid** (wrong enum / missing required) → `AGENT_OUTPUT_INVALID`.
- structured object **PM CORRECT with empty instructions** → `AGENT_OUTPUT_INVALID` (superRefine — the
  spike's proven gap).
- structured object **malformed `decision_id`** → `AGENT_OUTPUT_INVALID` (pattern).
- structured **non-object** (scalar/array/null) → `AGENT_OUTPUT_INVALID`.
- **YAML fallback still valid** and **YAML malformed still rejected** (delegation unchanged).

`src/cli/run.test.ts` (extend):
- `--json-file`/`--json-stdin` valid + invalid; mode-combination usage error.
- PM `--expected-decision-id` cross-check passes/fails on **both** YAML and structured paths.

JSON Schema generation:
- snapshot test per role of `z.toJSONSchema(SCHEMAS[role])` (regression guard).
- **no-drift test:** the emitter consumes the *same* `SCHEMAS` map Core validates with, so drift is
  impossible by construction; the snapshot catches unintended emission changes. Add an equivalence test
  pinning the 3 duplicated primitives (`NonEmptyString`/`TicketId`/`NonNegInt`) against `enums.ts`.

`parse-output.test.ts` / `charter-output-format.test.ts`: must stay green unchanged (YAML path intact).

---

## Migration Plan

- **Phase 1a — `schemas.ts` → `zod/v4` (Core-only, TDD).** Switch the `z` import; add the 3 local
  primitives; verify the full suite green (no exact-message asserts to break). `parse-output.ts` and
  type consumers unchanged. Allowed paths: `src/agents/schemas.ts` (+ a primitive-equivalence test).
- **Phase 1b — ingest adapter + CLI (Core-only, TDD).** Add `src/agents/ingest.ts`; add
  `--json-file`/`--json-stdin` and `forge agent-schema <role>` to `cli/run.ts`; snapshot tests. YAML and
  cross-check untouched.
- **Phase 1c — run-report source tracking (separate, sensitive).** Additive optional
  `agent_output_source` on `forge-run-report/v1` + assembler wiring. Own ticket; `run-report/**` in scope.
- **Phase 2 — workflow runner** consumes `forge agent-schema` + `agent({schema})` + `parse-agent
  --json-file`. Proven on one self-run + one external target before promotion.
- YAML remains the fallback throughout; `/forge-run-ticket` unchanged until the runner proves out.

Phasing note: 1a and 1b could be one ticket (both Core-only, additive, tightly coupled), but 1a is a
clean standalone (schema-runtime swap) worth landing + verifying first to isolate any Zod-4 surprise.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Dual Zod runtimes (3 + 4) in-process | Low–Med | No cross-runtime schema composition (role schemas are standalone; only `.safeParse`d). Confirmed safe by design; verify suite. |
| Primitive duplication drift (`NonEmptyString`/`TicketId`) | Low | Equivalence test pinning the local copies against `enums.ts`. |
| Zod 4 inference / error-message deltas | Low | `parse-output.test.ts` asserts no exact messages (verified); downstream uses structural types only. |
| `run-report/v1` schema change (1c) | Med | Additive `.optional()` only; separate scoped ticket; explicit risk call-out; keep `safety.*` literals untouched. |
| Workflow `agent({schema})` API undocumented / research-preview | Med | Phase 2 concern; adapter is independent of it (validates whatever object arrives). Don't hard-code its envelope. |
| Emitted JSON Schema carries `minLength`/`pattern`/bounds | Low (workflow surface) | Spike: workflow path tolerated them. Revisit only if targeting raw Messages-API. |

---

## Recommendation

Proceed to a **Phase 1a+1b implementation ticket** (Core-only, TDD): migrate `schemas.ts` to `zod/v4`
(Option A, 3 local primitives, `enums.ts` untouched), add the `ingest.ts` adapter, the
`--json-file`/`--json-stdin` CLI modes, and the `forge agent-schema <role>` emitter with snapshot +
primitive-equivalence tests. Keep YAML + the PM cross-check verbatim. **Defer run-report source tracking
(1c) to its own small ticket** because it touches the frozen `forge-run-report/v1` schema. Do not start
without a PM go; do not begin the workflow runner.
