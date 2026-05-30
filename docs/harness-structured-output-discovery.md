# Harness / Structured-Output Architecture Discovery

> Discovery/design only. Author: senior engineer, 2026-05-29. Status: **for PM review — no
> implementation.** Builds on `docs/workflow-era-architecture-audit.md` and
> `docs/workflow-backed-runner-design.md` (the accepted baselines) and on the now-shipped C4 ledger
> hardening ([[ledger-hardening-shipped]], PR #8, `5ba802c`).
>
> No epic, branch, commit, PR, or `/forge-run-ticket` run produced. No YAML removed, no parser/schema
> changes, no charter/command edits. Structured-output facts are grounded in current official docs
> (researched 2026-05-29); items official docs do not pin down are labelled **(UNVERIFIED)**.

---

## Executive Recommendation

Move ForgeGate to **schema-first structured JSON output at the harness boundary, with YAML retained as
the fallback compatibility layer** — and keep Core's Zod validation as the authoritative gate on
*both* paths. The goal is not "delete YAML"; it is **"move YAML out of the agent-output hot path while
preserving Core validation and auditability."**

The single most important technical finding makes this safe and clarifies the design: **Zod
`.refine()`/`.superRefine()` cannot be represented in JSON Schema** (the runtime silently drops them).
ForgeGate relies on refinements (`PMOutputSchema`'s "CORRECT requires instructions"; the new
`DecisionsLedgerSchema` sequence rule). Therefore the runtime's JSON-Schema constraint can only
guarantee *structure*, never ForgeGate's invariants — **the second Zod pass in Core is the only place
those are enforced, so it is mandatory, not redundant.** Structured output is an *optimization that
eliminates the "please emit YAML correctly" failure class*, layered on top of an unchanged Core gate.

**Recommended sequence:** a tiny throwaway **verification spike first** (the workflow `agent({schema})`
contract and a real `z.toJSONSchema` emission are the two things official docs don't pin down), *then* a
Core-only **source-agnostic ingest adapter** that accepts either a structured object or YAML and funnels
both through the same Zod validation. Do not touch the Markdown path, charters, or build the workflow
runner yet.

---

## Current YAML Dependency Map

**Critical scope distinction — two unrelated uses of YAML in this repo:**
- **Contract YAML (OUT of scope, stays):** `epic.yaml`, `sprint-*/manifest.yaml`, ticket front-matter —
  parsed by `src/fs/front-matter.ts:1,37` and `src/validate/load.ts:147,192`. This is the
  *human-authored contract format*, not agent output. **This migration does not touch it.**
- **Agent-output YAML (IN scope):** the engineer/verifier/PM *emissions*. This is the "hot path" Dan
  means.

Agent-output YAML dependency surface:

| Site | What depends on YAML | Classification |
|---|---|---|
| `src/agents/parse-output.ts` | The agent-output parser: `extractYamlFencedBlocks` + `parseYaml` + role Zod `safeParse` (`:48-73`). The hot-path entry point. | **adapt** — becomes the *YAML branch* behind a source-agnostic adapter; keep for fallback. |
| `src/agents/schemas.ts` | The four role Zod schemas (`EngineerOutputSchema`, `SemanticVerifierOutputSchema`, `ScopeVerifierOutputSchema`, `PMOutputSchema`). | **keep — source of truth.** Reused verbatim by both paths and as the JSON-Schema source. |
| `src/cli/run.ts:228-279` | `forge parse-agent <role>` reads `--file/--stdin` YAML, calls `parseAgentOutput`, plus the PM `--expected-decision-id` cross-check. | **adapt** — add a structured-input mode (accept a JSON object), same Zod validation + same cross-check. Keep YAML mode. |
| `src/orchestrator/dispatch.ts` (`buildPmDispatch`, `:253-302`) | Re-validates the 3 upstream outputs via `parseAgentOutput` from raw YAML strings before assembling the PM prompt. | **adapt** — accept already-validated structured objects when the harness provides them; keep YAML re-parse for fallback. |
| `src/run-report/cli.ts:190-208` | Reads `engineer/semantic/scope/pm` `.yaml` files, `parseAgentOutput` each as run-report inputs. | **adapt** — accept structured inputs; record the source. |
| `src/run-report/assemble.ts:66-71,176` | `agent_outputs` records the `.forge/*-output.yaml` *paths*. | **adapt** — record source (`structured_output` \| `yaml_fallback`); revisit self-containment (hash/embed). |
| `commands/forge-run-ticket.md` (steps 5, 8, 9; `:57-58,70-71,90-99`) | Captures raw agent output to `.forge/*-output.yaml` and runs `parse-agent`. | **keep for fallback / retire later** — this is the Markdown orchestrator path; stays as fallback. The workflow runner won't use these steps. |
| `agents/forge-engineer.md`, `forge-semantic-verifier.md`, `forge-scope-verifier.md`, `forge-pm.md` | "Emit exactly one YAML object" + YAML-output rules (block-style, quoting). | **keep for fallback** — the harness path won't rely on these prose rules (structured output makes them moot); the Markdown path still needs them. |
| Tests: `parse-output.test.ts`, `charter-output-format.test.ts`, `cli/run.test.ts` (parse-agent), `run-report/cli.test.ts`, `pm-dispatch.test.ts` | Lock the YAML behavior. | **keep + extend** — add structured-path tests alongside; never weaken the YAML-fallback tests. |

**Takeaway:** YAML is concentrated behind one validator (`parse-output.ts`) and four schemas
(`schemas.ts`). Everything else consumes the *validated object*. So the migration is small in surface:
introduce a source-agnostic ingest that yields the same validated object, and the rest of Core is
already source-independent.

---

## Structured-Output Target Model

**Confirmed runtime mechanism (Agent SDK / API, researched 2026-05-29):** supply
`outputFormat: { type: "json_schema", schema }`; the runtime grammar-constrains decoding to the schema
and returns a `structured_output` object; on non-conformance it **re-prompts, then errors**
(`error_max_structured_output_retries`) — never silent, never null. JSON Schema subset limits:
`additionalProperties:false` required, `minItems` only 0/1, no string-length/numeric bounds, no
recursion, `enum` scalars only, ≤16 union-typed params, plus `refusal`/`max_tokens` escape hatches.

Per role (harness path):

| Role | Returns | Schema source | Notes |
|---|---|---|---|
| engineer | `EngineerOutput` object | `z.toJSONSchema(EngineerOutputSchema)` | flat object + two object-lists; fits the subset. |
| semantic-verifier | `SemanticVerifierOutput` | `z.toJSONSchema(...)` | `acceptance_checked`/`findings` arrays; `id: string\|number` union — verify union emission. |
| scope-verifier | `ScopeVerifierOutput` | `z.toJSONSchema(...)` | string-lists + enums; trivially fits. |
| pm | `PMOutput` | `z.toJSONSchema(...)` | **`.superRefine` (CORRECT→instructions) is NOT in the JSON Schema** — enforced only by the Core Zod pass. `decision_id` regex `^D-\d+$` also not enforced by JSON Schema (no pattern in the supported subset for our case) → Core enforces. |
| core-runner | n/a | — | runs the `forge` CLI; returns CLI stdout/exit (a small result schema), not a role output. |

**Answers to the design questions:**
- **Reuse existing Zod schemas?** Yes — `schemas.ts` stays the single source of truth.
- **Generate JSON Schema from Zod?** Yes — `z.toJSONSchema()` (Zod 4 native). Do **not** hand-maintain
  parallel JSON Schemas (drift risk). Snapshot-test the generated JSON Schema so drift is visible.
- **Where does runtime validation happen?** At the harness boundary (grammar-constrained decoding +
  structured-output validation) — guarantees *structure* only.
- **Where does Core validation still happen?** Always, unconditionally: `SCHEMAS[role].safeParse(obj)`
  on the ingested object — the **authoritative** layer that enforces `.superRefine`, regex,
  `NonEmptyString`, `.strict()`, and the PM decision-id cross-check.
- **What if structured_output is missing/invalid?** The runtime already errored before returning (so the
  orchestrator treats it as `AGENT_OUTPUT_INVALID` → ESCALATE, identical to today's malformed-YAML
  halt). Defensive: also treat `refusal`/`max_tokens` stop reasons and any failed Core `safeParse` as
  `AGENT_OUTPUT_INVALID`. **Never repair** — unchanged thesis.

**The adapter (design):** a new source-agnostic ingest (e.g. `src/agents/ingest.ts`) with one entry that
accepts `{ source: "structured", value: unknown } | { source: "yaml", text: string }`, routes YAML
through the existing `parseAgentOutput` extractor and structured through `JSON`-already-an-object, then
funnels **both** into the same `SCHEMAS[role].safeParse`. Returns the same `ParseResult<T>` shape so all
downstream Core code is unchanged.

---

## Harness Boundary Design

| Owner | Responsibility |
|---|---|
| **Workflow / harness runtime** | Dispatches agents; requests structured output via JSON Schema; grammar-constrains + re-prompts; returns the `structured_output` object (or errors). Guarantees **structure only**. |
| **Forge Core** | Owns the Zod schemas (truth) and the **authoritative re-validation** of every ingested object (refinements, regex, strict, cross-checks); owns guard, ledger, run-report, gate. Source-agnostic. |
| **Agents** | Produce a structured object (harness path) or a YAML emission (fallback). |
| **Human** | Approves at workflow launch + at the commit gate; reads the run-report. |

- **Runtime validates:** the JSON-Schema subset (shape, enums, required, `additionalProperties:false`).
- **Core revalidates:** the *full* Zod schema — the only place ForgeGate's invariants live.
- **Artifact back to the human:** the Core-owned run-report (now recording `agent_output_source` per
  role for auditability), unchanged in its `safety.*: z.literal(false)` guarantees.

This is the two-layer model Dan asked for: **runtime schema enforcement + Forge Core schema enforcement**
— and the second layer is provably load-bearing because refinements aren't representable in the first.

---

## Migration Plan

Dan's proposed phasing is sound; I insert a **Phase 0 spike** because two load-bearing facts are
unverified by official docs, and refine the ordering:

- **Phase 0 — Verification spike (throwaway, research).** Empirically confirm: (a) the workflow
  `agent(prompt, {schema})` contract — does it validate against JSON Schema, re-prompt, and *error*
  (vs return null)?; (b) `z.toJSONSchema()` emission for the real role schemas — inspect that `.strict`
  → `additionalProperties:false`, the `id: string|number` union, and `z.literal`/enum emit
  API-compatible JSON; (c) whether a workflow can scope tools per-agent or only via the session
  allowlist. Output: a findings note. **No production code.**
- **Phase 1 — Source-agnostic ingest adapter (Core-only, TDD).** Add `src/agents/ingest.ts` (accepts
  structured object OR YAML; both → same Zod) + JSON-Schema generation from the role schemas +
  snapshot tests. `parse-output.ts`/`schemas.ts` unchanged in behavior; `parse-agent` gains a
  structured-input mode. Markdown path untouched. Additive only.
- **Phase 2 — Workflow runner uses structured output.** The workflow-backed runner (from
  `workflow-backed-runner-design.md`) requests structured output via the generated JSON Schema and
  ingests through the adapter. Proven on **one self-run + one external safe target** (the standing
  condition) before promotion.
- **Phase 3 — YAML as fallback only.** Markdown `/forge-run-ticket` keeps the YAML path; docs steer
  users to the harness runner. No removal.
- **Phase 4 — Optional deprecation decision.** Only after the harness path is proven; not pre-committed.

**Challenge to the proposed sequence:** do not design the Phase 1 adapter's *input contract* until
Phase 0 confirms what the runtime actually returns and how it fails — otherwise we hard-code an
unverified envelope. Phase 0 is cheap and de-risks everything downstream.

---

## Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Zod↔JSON-Schema drift** (`.superRefine`/regex/string-bounds dropped) | High (silent) | Generate JSON Schema *from* Zod (single source); **Core Zod re-validate is the authority** and enforces everything the JSON Schema can't; snapshot-test the generated schema so drift is visible in PRs. |
| **Runtime escape hatches** (`refusal`, `max_tokens` → schema-violating output) | Medium | Treat both stop reasons + any failed Core `safeParse` as `AGENT_OUTPUT_INVALID` → ESCALATE. Never repair. |
| **JSON-Schema subset limits** (no recursion, `minItems` 0/1, `additionalProperties:false`) | Low–Med | ForgeGate role schemas are flat objects + string/object lists — likely fit; **Phase 0 verifies** the exact emission (esp. the `id: string\|number` union and `.strict`). |
| **Workflow `agent({schema})` contract unverified** | Med | Phase 0 spike before adapter design; do not assume throw-vs-null. |
| **Loss of human-readable YAML reviewability** | Low | Structured objects serialize to readable JSON; run-report records the captured output + source; YAML fallback keeps the prose form. |
| **Workflow token cost** (re-prompt on mismatch) | Low | Offsets the eliminated re-dispatch-on-bad-YAML cost; a ForgeGate run is ~5 agents, not a 100-agent sweep. |
| **Tool-allowlist scoping uncertainty** | Med | Confirmed: deny `git push`/`gh`/network at the **session allowlist** layer (agents inherit it). Per-agent scoping is a Phase 0 question. |
| **Zod 4 dependency** (`z.toJSONSchema` needs Zod 4) | Med | ForgeGate pins `zod ^3.24.1`; installed 3.25.76 ships Zod 4 under the `zod/v4` subpath. Decide: adopt the subpath or migrate to Zod 4 (Open Question). |
| **Breaking the slash-command path** | High if rushed | Phase 1 is additive; the Markdown/YAML path is untouched until the harness runner is proven. |

---

## Recommended Next Ticket

**A Phase 0 verification spike — not production code.** Smallest unit that closes the three official-doc
gaps before any adapter is designed:
1. Confirm the workflow `agent({schema})` (or Agent SDK `outputFormat`) structured-output contract and
   its mismatch behavior, empirically.
2. Run `z.toJSONSchema()` on the four role schemas (via Zod 4 / the `zod/v4` subpath) and inspect the
   emitted JSON for API-subset compatibility (`additionalProperties:false`, the `id` union, enums,
   absence of the dropped `.superRefine`).
3. Confirm tool-allowlist scoping for workflow agents.

Output is a short findings note appended here or in a Phase-0 doc; **throwaway code, discarded after.**
Only after that does the Phase 1 ingest-adapter ticket get authored. **Do not start without a PM go.**

---

## What Not to Build

- Do not remove YAML, change `parse-output.ts`/`schemas.ts` behavior, or edit charters/commands now.
- Do not build the workflow runner yet (that is Phase 2, after the runner design + this adapter).
- Do not hand-maintain parallel JSON Schemas (generate from Zod).
- Do not migrate to Zod 4 blindly as a side effect — make it a deliberate, scoped decision.
- Out of scope as always: `run_id`/`attempt_id`, status write-back, journal automation, hooks, doctor,
  init-target, installer/plugin, auto commit/push/PR/merge, multi-ticket behavior.

---

## Open Questions for Dan

1. **Zod 4 path.** Structured-output JSON-Schema generation wants Zod 4's `z.toJSONSchema`. Adopt the
   `zod/v4` subpath the installed version already ships, or do the full Zod 3→4 migration first? My lean:
   use the subpath in the Phase 0 spike to learn, decide the full migration separately.
2. **Run-report evolution.** Record `agent_output_source: structured_output | yaml_fallback` per role —
   additive optional field on `forge-run-report/v1`, or roll it into the eventual v2 alongside
   self-containment (hash/embed captured outputs)? My lean: additive optional field now; defer
   self-containment.
3. **Phase 0 spike — OK to run throwaway research code?** It's the cleanest way to close the unverified
   workflow `agent({schema})` contract; it writes nothing production and is discarded. Your call.
4. **PM decision-id cross-check under structured output.** The PM returns `decision_id` as a structured
   field; Core's `--expected-decision-id` cross-check still applies at the ingest/validate layer
   (unchanged). Confirming you want that cross-check preserved verbatim on the harness path (I assume yes).
