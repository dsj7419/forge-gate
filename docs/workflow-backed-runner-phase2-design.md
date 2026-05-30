# Workflow-Backed Runner Phase 2 Design

> Phase 2 design doc. Author: senior engineer, 2026-05-29. Status: **for PM review — no
> implementation.** Supersedes nothing; **extends and reconciles**
> `docs/workflow-backed-runner-design.md` and `docs/workflow-era-architecture-audit.md`
> against the now-shipped baseline (PR #8 ledger hardening / C4, PR #10 structured-output ingest).
>
> Design only. No epic, branch, commit, push, PR, schema change, or `/forge-run-ticket` run was
> produced for this document. Evidence is cited inline by `path:line`. Claude Code platform facts
> are from official docs (researched 2026-05-29 via three independent doc passes); anything the
> docs leave open is labelled **(UNVERIFIED)** or **(research-preview)**.

---

## Executive Summary

The product line is settled: **Claude Code provides intelligence and execution; Forge Core provides
deterministic governance, validation, provenance, evidence, and the human/policy gate.** This design
specifies how a Claude Code **dynamic workflow** becomes the *preferred* execution substrate for a
one-ticket run while **Forge Core stays the deterministic trust boundary** — without weakening the v1
safety model, and embracing (not resisting) the platform's best primitives.

Three things are now true that the earlier design docs predate and that sharpen this plan:

1. **C4 already shipped (PR #8).** `DecisionsLedgerSchema` enforces uniqueness + strict monotonicity
   (`src/orchestrator/decisions-ledger.ts`), and `appendDecision` rejects any id that is not exactly
   `nextDecisionId(existing)` with `LEDGER_SEQUENCE_INVALID`. The append-layer decision-id duplication
   risk the runner-design called "possible today" is **closed**. Only the *assignment* seam (C3)
   remains.
2. **Structured ingest shipped (PR #10).** `ingestAgentOutput` (`src/agents/ingest.ts`) funnels both
   structured objects and YAML through the same `validateRole`/`ROLE_SCHEMAS`; `forge agent-schema
   <role>` emits JSON Schema from the same source; `forge parse-agent --json-file/--json-stdin` exists.
   **The workflow runner's agent-output path is already built and tested** — Phase 2 *consumes* it.
3. **A decisive platform finding:** per current Claude Code docs, the **strongest documented
   enforcement of "no outward action" is a `PreToolUse` hook (or a settings `deny` rule), not the
   subagent `tools:` allowlist** (which is tool-name granularity only — it cannot express "Bash but
   not `git push`"). This is in direct tension with ForgeGate's standing "hooks deferred" rule and is
   the single most important decision this design surfaces for Dan (see §Human and Policy Gate Model).

**The central design move remains provenance relocation**: make the *effective gate* and the *monotonic
decision id* flow **Core-file → Core-file**, never transiting the orchestration layer (Markdown *or*
workflow) as a re-typed flag. Once they never pass through the orchestrator, the trustworthiness of the
execution substrate becomes irrelevant to gate and decision-id provenance. Those two hardening items
(gate provenance + decision-id assignment) are the runner's trust foundation and strengthen the Markdown
fallback for free.

**The honest gate reframe is unchanged and load-bearing:** Core *attests*; the substrate *prevents*.
Core is a CLI that writes JSON — it cannot stop a `git push`, only refuse to attest one. A workflow
makes prevention *stronger* than today's prose only if built as a reviewed script with no outward stage
**plus** a tool-deny backstop. This design specifies that backstop precisely and recommends the
defensible layering.

**Recommended path:** land the two substrate-independent Core hardening tickets first (gate provenance,
then decision-id assignment), then the small run-report source-tracking field (Phase 1c), then build the
workflow runner (a reviewed saved script + a `forge-core-runner` agent type) and prove it on one
self-run and one external safe target before promoting it. The Markdown `/forge-run-ticket` stays a
maintained fallback. No sunset.

---

## Goals

1. Let a dynamic workflow drive the proven one-ticket loop (engineer → independent verify → guard →
   semantic-verifier → scope-verifier → PM → commit gate) as deterministic JS, replacing the
   LLM-interprets-Markdown choreography.
2. Route **every consequential boundary** through the Forge Core CLI (`validate`, `run --dry-run`,
   `packets`, `active-ticket`, `dispatch`, `guard paths`, `parse-agent`, `agent-schema`,
   `run-report write`).
3. Use Claude Code **structured output** (`agent({schema})` fed by `forge agent-schema <role>`) as the
   preferred agent-output path, with **Core Zod re-validation authoritative on both paths** and YAML
   retained as fallback.
4. Move **gate provenance** and **decision-id provenance** fully into Core so no orchestration layer can
   launder an LLM-supplied value into a Core artifact.
5. Define precisely **where the human/policy gate physically lives** under a workflow substrate, and a
   forward-looking policy-tier model, while keeping v1 strictly human-gated.
6. Produce a single Core-owned evidence artifact (the run-report + a clean human handoff) so a user can
   walk away and return to professionally-executed, tested, scope-verified, evidence-backed work.
7. Preserve `/forge-run-ticket` as a maintained, portable fallback; the `forge` CLI runs anywhere.

## Non-Goals

- **Implementation of anything here.** Design only.
- A multi-ticket loop, parallel-ticket execution, scheduling, or any custom orchestration engine —
  dynamic workflows own that lane (audit §What Should Not Be Built).
- Auto-commit, auto-push, PR automation, merge automation, status write-back, journal automation,
  `run_id`, `attempt_id`.
- Hooks as a *shipped* enforcement layer — **designed and recommended here, but gated on an explicit
  Dan decision** because the standing rule defers hooks (§Human and Policy Gate Model).
- Agent SDK / headless productization — designed as a future tier, not built.
- Removing YAML or editing charters' YAML rules (they remain the fallback contract).
- Expanding `verify-install` to cover workflow artifacts (deferred until a runner artifact exists).
- Making the run-report self-contained / content-addressed (recorded as a future question).

---

## Current Baseline

```
main @ c34e8c2 · 487 tests / 35 files green · typecheck/build PASS · verify-install 9/9 OK
```

**What exists and is durable (all KEEP):**

- **Core CLI router** (`src/cli/run.ts`) with injected `CliIo`; every subcommand maps to one module.
- **Contract validation / selection / packets** — `forge validate`, `run --dry-run`, `packets`
  (`src/orchestrator/packets.ts`), pinning absolute `repo_root` + cwd discipline (the §14 lesson).
- **Active-ticket emitter** — `forge active-ticket` (`src/cli/active-ticket.ts`) → `forge-active-ticket/v1`
  (`src/guard/active-ticket.ts`). **Deliberately drops the gate** (`active-ticket.ts:9-11`).
- **Deterministic path-fence guard** — `forge guard paths` (`src/guard/path-guard.ts:61` `evaluateFence`,
  `REPO_ROOT_MISMATCH` short-circuit at `:64`), pure + IO-injected (`src/guard/cli.ts`).
- **Source-agnostic agent ingest** — `ingestAgentOutput` (`src/agents/ingest.ts`), `validateRole`
  (`src/agents/parse-output.ts`), zod/v4 role schemas + `toRoleJsonSchema` (`src/agents/schemas.ts`),
  `forge parse-agent --file/--stdin/--json-file/--json-stdin`, `forge agent-schema <role>`.
- **Decision-id allocator + hardened ledger** — `nextDecisionId` (`src/orchestrator/decision-id.ts:18`),
  `appendDecision` with `LEDGER_SEQUENCE_INVALID` (C4 shipped, `decisions-ledger.ts`).
- **Run-report writer + schema** — `forge run-report write` (`src/run-report/cli.ts`), `assembleRunReport`
  (`src/run-report/assemble.ts`), `RunReportSchema` `.strict()` with `safety.*` and
  `final_branch_status.committed` typed `z.literal(false)` (`src/run-report/schema.ts:104-141`).
- **The Markdown orchestrator** (`commands/forge-run-ticket.md`) — an LLM-interpreted ~140-line
  procedure; the only non-deterministic surface and the thing Phase 2 replaces (keeps as fallback).

**The two open seams (this design closes both):**

- **Gate provenance.** `forge run-report write` takes `--gate-declared/effective/human-required`
  (`src/run-report/cli.ts:130-132`). The source of truth is Core's `active_run.gate`
  (`packets.ts`), but the orchestrator captures and re-passes it (`forge-run-ticket.md:41-45`), and the
  assembler's `HUMAN_GATE_MISMATCH` compares the PM's value against that orchestrator-supplied flag.
  Core cannot cross-reference because the active-ticket **omits** the gate. Feeding the PM's own value
  into `--gate-human-required` makes the check tautological — PR #6's bug, one layer up. The code itself
  documents this risk (`run-report/cli.ts:125-129, 233-238`).
- **Decision-id assignment.** `nextDecisionId` is pure/tested but the *orchestrator* computes the next id
  (prose, `forge-run-ticket.md:77-79`) and passes `--assigned-decision-id`. Core cross-checks the PM
  *echo* (`DECISION_ID_MISMATCH`) and the ledger append now enforces exact-next (C4) — but **assignment
  still originates in the orchestration layer**, so a miscomputed id is caught only by the append guard,
  not prevented at source.

---

## Target Architecture

```
Human approves the workflow at launch
        │
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Saved, reviewed dynamic-workflow script  (deterministic JS)           │
│  - owns: sequence, correction loop (cap 3), intermediate variables     │
│  - has NO direct fs/shell (platform constraint) — all work via agents  │
│  - contains NO outward-action stage (no commit/push/PR/merge call)     │
└──────────────────────────────────────────────────────────────────────┘
   dispatches agents (Task), each pinned to absolute repo_root:
        ├─ forge-core-runner   → runs `forge <cmd>` + read-only git; returns {exit, stdout} (schema)
        ├─ forge-engineer      → edits allowed_paths, runs verify_commands (structured output)
        ├─ forge-semantic-verifier → acceptance vs repo reality, read-only (structured output)
        ├─ forge-scope-verifier    → diff in-fence, read-only (structured output)
        └─ forge-pm            → PASS/CORRECT/ESCALATE (structured output)
   every consequential boundary is a forge CLI call via forge-core-runner:
        forge validate · run --dry-run · packets · active-ticket · agent-schema
        guard paths · parse-agent (--json-*) · dispatch pm · run-report write
        │
        ▼
Returns the Core-owned run-report (PASS + commit-gate materials, or ESCALATE + recovery brief)
        │
        ▼
Human reviews the report and performs the outward action (commit / push / PR / merge)
```

**Platform constraints that shape this (official docs, 2026-05-29):**

- **The workflow script has no direct filesystem or shell access** — "agents read, write, and run
  commands; the script coordinates." Therefore every `forge` call and every git read happens *inside a
  dispatched agent* (`forge-core-runner`), and the script holds only structured results in variables.
  This is a feature: deterministic JS data-flow between stages replaces LLM-narrated control flow.
- **`agent(prompt, opts)`** supports `{label, phase, schema, model, isolation, agentType}`. **There is
  no per-call tool/allowlist parameter** — tool scope is set by the `agentType`'s subagent definition
  and the session permission set. (Two of three doc passes confirm `agentType` as an `agent()` opt; one
  pass could not find it in public docs — **treated as available per the Workflow tool contract, to be
  re-confirmed empirically in the spike.**)
- **`agent({schema})` returns a validated object directly**; on non-conformance the runtime re-prompts
  then errors (`error_max_structured_output_retries` in the SDK; exact workflow behavior
  **UNVERIFIED/research-preview**). The runner treats any error/refusal/`max_tokens` as
  `AGENT_OUTPUT_INVALID` → ESCALATE.
- **Workflows are research-preview, paid-plan, token-heavy**, capped at 16 concurrent / 1000 total
  agents, and **resume only within the same session** (an interrupted run restarts fresh). The lock
  design (below) must make a fresh restart safe.

---

## Workflow Responsibilities

The script is deterministic orchestration JS. It **owns**:

- **Phase ordering** and the **correction loop** (PM `CORRECT` → re-dispatch engineer, JS counter, cap 3
  → `CORRECTION_CAP_REACHED` → ESCALATE; matches `forge-run-ticket.md:108-109`).
- **Agent dispatch** of the five role agents via `agent({agentType, schema})`.
- **Parallel verifier execution** — semantic + scope verifiers can run via `parallel([...])` once the
  engineer change-set + guard result exist (they are independent, read-only).
- **Capturing structured outputs** into script variables, and instructing `forge-core-runner` to persist
  each to its canonical `.forge/<role>-output.*` path for the evidence trail.
- **Calling Forge Core** at every boundary (via `forge-core-runner`), `JSON.parse`-ing stdout where the
  command emits JSON.
- **Assembling the handoff**: collecting the Core-owned run-report and presenting the commit-gate
  materials (or recovery brief) as the workflow's single returned answer.
- **Preflight + lock discipline**: validate, dry-run, clean-tree check, `.forge/lock.json` presence
  check; refuse a dirty or locked restart (idempotent restart, never silent re-run).

The script **must NEVER own** (enforced by the script containing no such call **and** by the tool-deny
backstop in §Human and Policy Gate Model):

- **commit authority** — no `git commit` stage.
- **push authority** — no `git push` stage.
- **merge authority** — no `git merge` / `gh pr merge` stage.
- **PR authority** — no `gh pr create` stage.
- **status write-back authority** — no edit to ticket/manifest/contract files.
- **journal mutation authority** — no edit to `JOURNAL.md`/`DECISIONS.md`.
- **release/deploy authority** — no publish/deploy stage.

…unless a later, explicitly-approved **policy tier** (§Human and Policy Gate Model) grants a specific one.

---

## Forge Core Responsibilities

Unchanged trust root (all KEEP), now also the sole owner of gate + decision-id provenance:

- **Contract validation** — `forge validate` (`src/validate/validate-contract.ts`).
- **Ticket selection + packets** — `forge packets` / `run --dry-run` (`src/orchestrator/packets.ts`),
  pinning absolute `repo_root` + cwd discipline.
- **Active-ticket fence (now gate-bearing)** — `forge active-ticket`
  (`src/cli/active-ticket.ts`, `src/guard/active-ticket.ts`).
- **Deterministic scope gate** — `forge guard paths` (`src/guard/path-guard.ts`, `guard/cli.ts`).
- **Source-agnostic, never-repair agent ingest + JSON-Schema emission** — `forge parse-agent`
  (`--json-*`/`--file`/`--stdin`), `forge agent-schema <role>` (`src/agents/*`). **Authoritative Zod
  re-validation on both paths** (the only place `.superRefine`, `decision_id` regex, `NonEmptyString`,
  `.strict()` are enforced — structured output's JSON-Schema layer cannot represent them).
- **Decision-id assignment + ledger integrity** — `forge dispatch pm` assigns via `nextDecisionId`
  (C3, new); `appendDecision` enforces exact-next (C4, shipped).
- **PM decision-id cross-check** — `parse-agent pm --expected-decision-id` (`DECISION_ID_MISMATCH`).
- **Typed, byte-deterministic attestation** — `forge run-report write` (`src/run-report/**`),
  `safety.*`/`committed` = `z.literal(false)`, deterministic serialization (`cli.ts:270-275`).

Core never improvises, never repairs, never auto-commits, and now never *accepts* the gate or the
decision-id from the orchestration layer as a source of truth.

---

## Gate Provenance Design

**Objective:** the effective gate flows Core-file → Core-file; no orchestration layer re-types it; the
`HUMAN_GATE_MISMATCH` check compares the PM's emission against a genuinely Core-sourced value.

**Options evaluated:**

| Option | Mechanism | Pros | Cons |
|---|---|---|---|
| **A — gate in active-ticket** | Add optional `gate {declared, effective, human_required}` to `ActiveTicketSchema`; `buildActiveTicket` emits it; `run-report write` reads it from the active-ticket it already loads (`cli.ts:224-231`). | Smallest change; the active-ticket schema *already* anticipates a tolerated `gate` field (`guard/active-ticket.ts:10-19` comment); one Core-owned artifact already on the path; strengthens Markdown fallback. | Slightly overloads the guard's fence artifact with a non-fence field (mitigated: it's optional and the guard ignores it). |
| **B — dedicated `forge-run-context/v1` artifact** | New Core-emitted artifact carrying gate (and later: assigned decision-id, checkpoint) read by `run-report write`. | Clean separation; natural home if more provenance accrues. | New schema + emitter + wiring now, for one field; more surface to version and verify. |
| **C — flags as cross-check only** | Keep `--gate-*` but require them to equal a Core-owned artifact; mismatch → typed failure. | Defense-in-depth. | Needs A or B to have a Core artifact to check against — not standalone. |

**Recommendation: A, with C layered on, converging toward B.** Add `gate` as an `.optional()` field on
`ActiveTicketSchema` (so it survives parse and `run-report` can trust it — note: today an unknown `gate`
key would be *stripped*, since the schema is non-`.strict()` but doesn't declare `gate`, so this is a
real, required change, not a no-op). `buildActiveTicket` emits it from `activeRun.gate` (it already has
it and currently drops it, `active-ticket.ts:9-11`). `run-report write` reads the gate from the
active-ticket file it already loads and feeds it to `runtime.effective_gate`; the `--gate-*` flags
**downgrade to optional cross-check** (must equal the active-ticket gate; mismatch → typed
`GATE_PROVENANCE_MISMATCH`), kept during migration, removable later. As decision-id assignment (C3) and
other run-context grows, the active-ticket *becomes* the de-facto Core run-context (A converges to B);
splitting to a dedicated artifact then is a clean, deferred refactor.

**Result:** `packets`/dry-run computes the gate → `active-ticket` persists it → `run-report write` reads
it. The gate never transits the workflow script. Closes the relocated PR #6 tautology under **any**
substrate. **Does not touch `run-report/schema.ts`** (the run-report already carries `gate` via
`GateSchema`) — only `cli/active-ticket.ts`, `guard/active-ticket.ts`, `run-report/cli.ts`,
`run-report/assemble.ts`.

---

## Decision-ID Provenance Design

**Objective:** Core assigns, renders, appends, and cross-checks the decision id; the orchestration layer
never computes it. (C4 — ledger exact-next enforcement — already shipped.)

**Exact recommended flow:**

1. **Core assigns (C3).** `forge dispatch pm` reads `decisions-ledger.json` via the existing
   `DecisionsLedgerIo` seam (`decisions-ledger.ts:41-46`), calls `nextDecisionId(existing)`
   (`decision-id.ts:18`) **internally**, and renders the assigned id into the PM packet's authoritative
   section (`buildPmDispatch`/`renderAssignedDecisionId`, `dispatch.ts`). On a malformed/missing ledger →
   typed failure (`LEDGER_INVALID`), never a silent recycle.
2. **Flag downgraded.** `--assigned-decision-id` becomes an **optional cross-check** (if supplied, must
   equal Core's computed value → else `DECISION_ID_ASSIGNMENT_MISMATCH`); never the source.
   `renderContext` still throws on a null assigned id (the PR #7 hardening), so a skeleton PM packet can
   never render without a pinned id.
3. **PM echoes.** The PM structured output returns `decision_id` (validated by Core Zod: regex
   `^D-\d+$`), and the agent never invents it (charter rule, unchanged).
4. **Core cross-checks the echo.** `parse-agent pm --expected-decision-id <Core-assigned>` →
   `DECISION_ID_MISMATCH` on disagreement (`cli/run.ts:256-276`), on both YAML and structured paths
   (PR #10 preserved this verbatim).
5. **Ledger append enforces exact-next.** `appendDecision` writes only if the entry equals
   `nextDecisionId(current)` → `LEDGER_SEQUENCE_INVALID` otherwise (C4, shipped). Per-attempt ledger
   reset (the designed `D-001` reuse across ESCALATE recovery) stays.

**Result:** assignment, rendering, echo cross-check, append, and integrity are **all Core**. The
orchestration layer (workflow or Markdown) only *triggers* the sequence. Surface decision: **fold
assignment into `forge dispatch pm`** rather than adding a separate `forge next-decision-id` command
(fewer surfaces; keeps assignment atomic with dispatch). Touches `src/cli/run.ts` +
`src/orchestrator/dispatch.ts` (+ tests); does **not** touch the run-report schema.

---

## Structured-Output Agent Path

**The path is already built (PR #10).** Phase 2 wires the workflow to it.

**Per role, the workflow runner:**

1. `forge-core-runner` runs `forge agent-schema <role>` → the role's JSON Schema (from the same
   `ROLE_SCHEMAS` Core validates with — drift impossible by construction).
2. The script calls `agent(rolePrompt, {agentType: "forge-<role>", schema})` → returns a validated
   object (structure/enums/`additionalProperties:false` enforced by the runtime).
3. The object is persisted by `forge-core-runner` to `.forge/<role>-output.json` (a write *inside* an
   agent — the script has no fs).
4. `forge-core-runner` runs `forge parse-agent <role> --json-file .forge/<role>-output.json`
   (PM: `--expected-decision-id`) → **Core's authoritative Zod re-validation** (the only enforcer of
   `.superRefine` / `decision_id` pattern / non-emptiness — spike-proven the runtime accepts objects
   Core rejects). `ok:false` → ESCALATE (`AGENT_OUTPUT_INVALID`/`DECISION_ID_MISMATCH`).

**Answers to the required questions:**

- **Where captured?** As the direct return value of `agent({schema})`, in a script variable; then
  persisted to `.forge/<role>-output.json` via `forge-core-runner`.
- **Where validated?** Twice: structure at the runtime boundary (JSON Schema), then **authoritatively**
  by Core Zod via `parse-agent --json-file` (and the PM cross-check).
- **Where stored?** Gitignored `.forge/` under the epic, same canonical paths as today (new `.json`
  variants alongside the existing `.yaml` fallback names).
- **What appears under `.forge/`?** `lock.json`, `active-ticket.json` (now gate-bearing),
  `<role>-output.json` (structured) **or** `<role>-output.yaml` (fallback), `orchestrator-facts.json`,
  `decisions-ledger.json`, `run-report.json` — mirroring today's set (observed in
  `docs/epics/forge-structured-output-ingest/.forge/`), with `.json` agent outputs on the structured
  path.
- **Does YAML appear on the workflow path?** **No** for agent outputs — the workflow path is structured
  JSON. YAML remains only on the Markdown fallback path. **Contract YAML** (`epic.yaml`, manifests,
  ticket front-matter) is unrelated and untouched on both paths.

---

## Custom Subagents / Agent Types

Five project subagents (`.claude/agents/*.md`), each with a `tools` allowlist + `permissionMode`. **Key
platform constraint:** `tools:` is *tool-name* granularity — it can grant or withhold `Bash`, but cannot
express "Bash except `git push`". Command-level denial requires a settings `deny` rule or a `PreToolUse`
hook (see §Human and Policy Gate Model). The table below states the *intent*; the *enforcement* of the
"denied" column is the gate model's job, not the `tools:` line alone.

| Agent | Edits? | Runs tests? | Runs Forge Core? | Tools (allow) | Denied (enforced by deny-rule/hook) | Notes |
|---|---|---|---|---|---|---|
| **forge-engineer** | ✅ allowed_paths | ✅ verify_commands | ❌ | `Read, Edit, Write, Glob, Grep, Bash` | `git push`, `gh`, `git commit`*, merge, deploy | Only role that writes source. `acceptEdits` in workflows is fine — guard + scope-verifier catch out-of-fence edits after the fact. (*commit denied in v1; a future tier may allow it.) |
| **forge-semantic-verifier** | ❌ read-only | reads results | ❌ | `Read, Glob, Grep, Bash(git -C * status/diff/log)` | all writes, push, gh, merge | Judges acceptance vs repo reality. |
| **forge-scope-verifier** | ❌ read-only | ❌ | ❌ | `Read, Glob, Grep, Bash(git -C * status/diff)` | all writes, push, gh, merge | Judges diff-in-fence; complements the deterministic guard. |
| **forge-pm** | ❌ read-only | ❌ | ❌ | `Read` | everything else | Decides PASS/CORRECT/ESCALATE on validated inputs only; no free-roam (the §14 lesson). |
| **forge-core-runner** (new) | ❌ (writes only `.forge/*`) | ❌ | ✅ | `Read, Bash(node <forge>/dist/cli.js *)`, read-only `Bash(git -C * rev-parse/status/diff/rev-list)`, `Write(.forge/**)` | `git push`, `gh`, `git commit`, `git merge`, any write outside `.forge/` | The bridge that lets the workflow invoke Core + read git without granting outward capability. Returns `{exit, stdout}` under a schema. |

**`forge-core-runner` is the security-critical new primitive.** It is the only agent that touches Core,
and the only one that writes (`.forge/` only). Its tool grant is the narrowest possible: run the Forge
CLI, read git, write `.forge/`. It must never be granted push/gh/commit/merge. Because `tools:` cannot
deny a specific Bash command, the "denied" column for *all* agents is enforced at the session/policy
layer (next section), not in the agent file.

---

## Human and Policy Gate Model

This is the load-bearing section, and where this design **challenges the standing "hooks deferred"
rule**.

**The honest baseline (unchanged):** Core *attests*, the substrate *prevents*. Core cannot stop a git
call; it produces the typed proof (`safety.*: z.literal(false)`, `assemble.ts` rejects
`final_branch_status.committed === true`) that nothing happened.

**Where prevention physically lives — three independent controls, strongest first:**

1. **Tool-deny backstop (strongest documented enforcement).** Per current docs, the hard stop on an
   outward action is either a settings `permissions.deny` rule — `deny: ["Bash(git push:*)",
   "Bash(gh:*)", "Bash(git commit:*)", "Bash(git merge:*)"]` (deny overrides allow across all scopes) —
   **or** a `PreToolUse` hook returning `permissionDecision: deny` / exit 2 (which blocks the call and
   can pattern-match the command). The subagent `tools:` allowlist is *not* sufficient alone (tool-name
   granularity). **This is the single most important platform finding of this design.**
2. **A reviewed script with no outward stage.** The saved workflow (`.claude/workflows/…`) contains no
   `agent()` call that issues commit/push/PR/merge. Because it is a checked-in, reviewed artifact, "no
   outward call" is statically auditable — strictly stronger than an LLM re-reading *"Do NOT commit"*
   each run (`forge-run-ticket.md:131`).
3. **The human at both ends.** Approve at workflow launch; review the returned run-report; perform the
   outward action manually.

**Recommended v1 enforcement (and the decision for Dan):** the defensible, world-class posture is
**control #1 as a real backstop**, not just #2 + #3. That means either a project `deny` ruleset shipped
with the runner, or a `PreToolUse` hook. **This collides with the standing "hooks deferred / skills≠
safety" rule.** My recommendation: adopt the **`permissions.deny` ruleset** as the v1 backstop (it is
*not* a hook — it is the documented, declarative permission layer, lower-ceremony and within current
policy), and **defer the `PreToolUse` hook to a later tier** as defense-in-depth. If Dan wants the
strongest possible net immediately, the hook is the tool — but that is an explicit policy reversal to
approve, not something to introduce silently. **Flagged as Open Question #1.**

**v1 policy (minimum, unchanged):**
```
workflow may edit + verify inside allowed_paths
workflow may NOT commit / push / open PR / merge / write status / write journal
workflow returns a Core-owned run-report + human handoff
human approves and performs all outward actions
```

**Future policy tiers (designed, NOT implemented — each is a deliberate, separately-approved step with
its own substrate review and, where it grants an outward action, a v2 run-report schema bump because the
relevant `safety.*` literal would change):**

| Tier | Grants | Enforcement delta | Run-report |
|---|---|---|---|
| `manual-only` (v1) | nothing outward | deny push/gh/commit/merge | `safety.* = false` |
| `commit-approved` | local commit on branch | allow `git commit`; still deny push/gh/merge | needs `safety.committed` relaxation → **v2** |
| `pr-approved` | push branch + open PR | allow push + `gh pr create`; deny merge | **v2** |
| `merge-approved` | merge the PR | allow `gh pr merge` | **v2** |
| `release-approved` | publish/deploy | allow the release command | **v2** |

The tier is a **policy object Core owns and the run-report records** — never something the workflow
self-selects. v1 ships only `manual-only`. Tiers are listed so they are not reinvented ad hoc.

---

## Evidence and Run-Report Model

The user returns to a single Core-owned artifact set (gitignored `.forge/`, surfaced in the handoff):

- **`run-report.json`** (`forge-run-report/v1`) — result (PASS/ESCALATE), ticket, branch, decision +
  `decision_id`, gate (now Core-sourced), checkpoint {base, head}, `parse_validation` (4 roles),
  `verify_command_results`, `guard` {result, exit}, `verifiers` {semantic, scope}, `final_changed_files`,
  `final_branch_status` (`committed: false`), `agent_outputs` (paths), `safety.*` (all `false`),
  optional `commit_gate_materials` + `notes`.
- **Changed files / test+typecheck results / guard result / semantic result / scope result / PM result**
  — all already fields of the report.
- **Decision ledger** — `decisions-ledger.json` (provenance chain).
- **Next recommended action** — `commit_gate_materials.proposed_status_transition` +
  `suggested_commit_message` + `suggested_commands` (PASS), or the recovery brief (ESCALATE).

**Source tracking (Phase 1c).** Add optional `agent_output_source: {engineer, semantic_verifier,
scope_verifier, pm: "structured_output" | "yaml_fallback"}` to `forge-run-report/v1` so a report records
*which ingest path* produced each PASS — essential auditability once two paths exist.
**Should it land before Phase 2 implementation? — Yes (recommended).** It is tiny and additive
(`.optional()`, backward-compatible), but it **touches the deliberately-frozen `run-report/schema.ts`**,
so it must be its own scoped ticket with `run-report/{schema,assemble,cli}.ts` + tests in
`allowed_paths`. Landing it *before* the first workflow pilot means the very first structured run emits
provenance-complete reports; landing it after leaves the first pilots under-instrumented. It is not a
hard blocker for the *design* or for the C1–C3 hardening, but it should precede the runner pilot.

**Future (deferred, not designed here):** run-report self-containment — embed or hash the captured agent
outputs instead of storing `.forge/` paths (`assemble.ts` stores paths; evidence currently survives only
via the manual `escalate-attempt<N>/` ritual). Real soft spot for the "attestation root" claim; revisit
with a v2.

---

## Claude Code Substrate Review

> Standing rule: every design classifies each capability to the right Claude Code primitive and keeps
> ForgeGate to deterministic governance/validation/provenance/evidence/gates — the layer the primitives
> do not provide. Compose with the best primitives; ForgeGate adds the governance they lack.

| Capability | Substrate | Rationale |
|---|---|---|
| Run orchestration (sequence, correction loop, parallel verifiers, dispatch, schema fetch, capture, invoke Core, assemble handoff) | **Dynamic workflow** | First-party deterministic-JS orchestration; replaces the LLM-interpreted Markdown. Research-preview, paid-plan — hence Markdown stays fallback. **Not the trust boundary.** |
| Agent emission (engineer/verifier/PM outputs) | **Structured output** (`agent({schema})`) | Returns a validated object; eliminates the "emit YAML correctly" failure class. Schema from `forge agent-schema`. YAML stays fallback. |
| Role isolation + tool scope | **Custom subagents / agent types** | `forge-engineer/-semantic-verifier/-scope-verifier/-pm/-core-runner`. `tools:` is tool-name granularity; **`forge-core-runner`** is the Core bridge with the narrowest grant. |
| **Outward-action prevention** | **Permissions `deny` (v1)** → **PreToolUse hook (future, defense-in-depth)** | The *strongest documented* enforcement. `deny` overrides `allow` across scopes; the hook can pattern-block and is the hard net. **Policy decision for Dan** (hooks currently deferred). |
| Contract validation, active-ticket (gate-bearing), guard, ingest adapter, `parse-agent`, `agent-schema`, decision-id assignment + ledger integrity, PM cross-check, run-report, gate provenance, evidence | **Forge Core** | The deterministic governance/validation/provenance/evidence layer. None of it moves to a primitive — it is exactly what the primitives do not provide. |
| Operating guidance (`/forge-run-ticket` procedure, adoption guide) | **Skill / Markdown command** | Reusable guidance + the portable fallback runner. **Never a safety boundary.** |
| Saved workflow runner artifact | **Dynamic workflow (saved, reviewed)** | Checked-in `.claude/workflows/…` so "no outward stage" is auditable; distributed to adopters (verify-install scope grows later — deferred). |
| Headless / CI productization of the same pattern | **Agent SDK / headless — future** | SDK supports structured output + custom agents + hooks programmatically but **does not expose the workflow `agent()/parallel()/pipeline()` DSL** (workflows are CLI-only). A headless tier would re-implement the orchestration in the SDK and reuse Core verbatim. Not next. |
| Status write-back, journal automation, `run_id`, `attempt_id`, auto commit/push/PR/merge, doctor, init-target, installer | **Deferred** | Out of v1 scope; each needs its own scope discussion + substrate review (and, for outward actions, a v2 schema bump). |

---

## Migration Plan

Dan's proposed sequence is sound; I **challenge the ordering** of one item (move gate/decision-id
provenance ahead of 1c, since they are schema-safe and close live seams, while 1c touches the frozen
schema and only needs to precede the *pilot*).

- **Phase 2a — Design finalization (this doc).** PM review; resolve the Open Questions (esp. the hook
  vs deny-rule policy decision).
- **Phase B1 — Gate provenance (C1+C2), gated Core ticket.** Add optional `gate` to active-ticket; emit
  it; `run-report write` reads it; `--gate-*` → optional cross-check (`GATE_PROVENANCE_MISMATCH`).
  Substrate-independent; strengthens the Markdown fallback. **No run-report schema change.**
- **Phase B2 — Decision-id assignment (C3), gated Core ticket.** `forge dispatch pm` assigns via
  `nextDecisionId`; flag → optional cross-check. Substrate-independent. **No run-report schema change.**
- **Phase 1c — Run-report source tracking, gated Core ticket (sensitive).** Additive optional
  `agent_output_source` on `forge-run-report/v1`. Own ticket; `run-report/**` in scope; keep `safety.*`
  literals untouched. Lands before the pilot so reports are provenance-complete.
- **Phase 2b — Workflow runner prototype + `forge-core-runner` charter + deny-ruleset, on a ForgeGate
  self-run.** Saved `.claude/workflows/forge-run-ticket.workflow.js` (or similar) + the new agent type +
  the v1 `permissions.deny` backstop. Prove the full loop to a commit-gate PASS on `sandbox-epic`.
  Frozen-build discipline (build before the self-run).
- **Phase 2c — External safe-target pilot.** One real, low-risk external repo (the standing
  one-self-run + one-external condition), test-only or trivially-scoped ticket.
- **Phase 2d — Promote** the workflow runner as the preferred path; `/forge-run-ticket` remains the
  maintained fallback; Core is the trust root for both. **No sunset.**
- **Adversarial pass (PM-gated, before 2d):** one targeted question — *can the workflow-backed runner
  bypass the human gate or launder LLM-supplied provenance (gate / decision-id) into Core artifacts?*

**Why this order beats "1c first":** B1 and B2 are pure provenance closes with **no schema risk** and
they harden the Markdown orchestrator *today*; 1c is the only schema-touching change and only needs to be
in place before 2b's pilot. Front-loading the schema-safe seam closures de-risks the sensitive change and
the runner build that follows.

---

## Recommended Next Ticket

**`forge-gate-provenance` — Phase B1 (C1+C2): make the effective gate flow Core-file → Core-file.**

- **Why this one:** it closes the *sharper* open seam (the relocated PR #6 tautology — the gate check can
  currently be made tautological), it is fully substrate-independent (strengthens the Markdown fallback
  immediately), and — critically — it **does not touch the frozen `run-report/schema.ts`** (the
  run-report already carries `gate`; only the *source* changes). That makes it the lowest-risk,
  highest-trust-value first step.
- **Scope (`allowed_paths`):** `src/guard/active-ticket.ts` (+ optional `gate` field),
  `src/cli/active-ticket.ts` (emit gate), `src/run-report/cli.ts` (read gate from active-ticket; flags →
  cross-check), `src/run-report/assemble.ts` (gate from active-ticket; new `GATE_PROVENANCE_MISMATCH`),
  and colocated tests. `commands/forge-run-ticket.md` updated to drop step-2 gate capture in a follow-up
  doc edit (or same ticket if fenced).
- **Acceptance (TDD):** active-ticket round-trips `gate`; `run-report write` derives the gate from the
  active-ticket and ignores/cross-checks the flags; a flag that disagrees with the active-ticket gate →
  `GATE_PROVENANCE_MISMATCH`; the existing `HUMAN_GATE_MISMATCH` semantics preserved against the
  Core-sourced gate; full suite green.
- **Contract-authoring caution:** title/body must avoid the negation-blind escalation keywords
  (`src/validate/escalation.ts`) and set `change_class: feature` (not `migration`/`security`); confirm
  `gate: pr, no escalation` via `forge run --dry-run` before the run (the PR #10 lesson).

**Then, in order:** `forge-decision-id-assignment` (C3) → `forge-run-report-source-tracking` (1c) →
the Phase 2b runner.

---

## Open Questions

1. **Hook vs deny-rule for the outward-action backstop (the key decision).** The strongest documented
   enforcement is a `PreToolUse` hook; the standing rule defers hooks. My recommendation: ship a
   `permissions.deny` ruleset as the v1 backstop (declarative, not a hook, within current policy) and
   defer the hook to a later defense-in-depth tier. **Approve the deny-rule approach, or reverse the
   hooks-deferred rule now?**
2. **Ordering challenge.** Do you accept moving gate/decision-id provenance (B1, B2) *ahead* of 1c, with
   1c landing just before the 2b pilot? (My lean: yes.)
3. **Gate artifact home.** Option A (gate in active-ticket) now, converging to a dedicated
   `forge-run-context/v1` (Option B) if more provenance accrues — or jump straight to B? (My lean: A
   now; B later only if needed.)
4. **Flag fate (C2/C3).** Keep `--gate-*` and `--assigned-decision-id` permanently as optional
   cross-checks (defense in depth), or remove once Core is the source? (My lean: keep as optional
   cross-check; never as source.)
5. **Decision-id surface.** Fold assignment into `forge dispatch pm` (preferred, fewer surfaces) or add
   `forge next-decision-id <epic>`? (My lean: fold in.)
6. **Workflow distribution + verify-install scope.** Saved workflow in project `.claude/workflows/` vs.
   shipped with the package for adopters — and when does `verify-install` grow to cover it? (My lean:
   project-local for the prototype; defer verify-install scope to Phase 3.)
7. **Empirical re-verification before 2b.** Three runtime facts are research-preview / not fully
   documented and should be spiked (throwaway, gitignored) before building the runner: (a) the workflow
   `agent({schema})` error/refusal behavior; (b) whether `agentType` is accepted by `agent()` and
   resolves a project subagent's tool grants; (c) that a workflow agent honors the session
   `permissions.deny`. Run the spike as step one of 2b, or as a tiny standalone first? (My lean: fold
   into the start of 2b.)
8. **Future, not now (flagged so they aren't reinvented):** run-report self-containment (hash/embed
   outputs); Agent SDK/headless tier; the policy-tier ladder beyond `manual-only`. None designed here.
