# Workflow-Backed ForgeGate Runner Design

> Phase 2 design doc. Author: senior engineer, 2026-05-28. Status: **for PM
> review — no implementation.** Anchored in and superseded-by-nothing of
> `docs/workflow-era-architecture-audit.md` (the accepted strategic baseline).
>
> Design only. No epic, branch, commit, push, PR, or `/forge-run-ticket` run was
> produced for this document. Evidence cited inline by path; line ranges where
> stable. Items I could not fully prove from code are labelled **(hypothesis)**.

---

## Executive Summary

The product line is settled: **workflows execute, ForgeGate governs, humans
approve outward action.** This design specifies how a Claude Code *dynamic
workflow* becomes the preferred execution substrate for a one-ticket run while
**Forge Core remains the deterministic governance boundary** — without weakening
the v1 safety model.

The central design move is **provenance relocation**: today the *effective gate*
and the *monotonic decision id* are computed by Core's logic but routed through the
orchestration layer (the LLM interpreting `commands/forge-run-ticket.md`) as CLI
flags, and Core validates only their format/echo
(`docs/workflow-era-architecture-audit.md` §Trust Boundary). This design makes both
values flow **Core-file → Core-file**, never transiting the orchestration layer at
all. The payoff is decisive: **once those values never pass through the
orchestrator, the trustworthiness of the execution substrate (Markdown *or*
workflow) becomes irrelevant to gate and decision-id provenance.** That is why the
two hardening items belong here — they are the runner's trust foundation, and they
strengthen the Markdown fallback at the same time.

The human gate is answered precisely: a workflow **cannot** be made to *prevent* an
outward action by Core (Core never could). Prevention lives in three substrate
properties — a reviewed script that contains no outward-action stage, a tool
allowlist that denies push/PR tools to the workflow's agents, and the human at
launch and at the returned run-report. Core's role is unchanged: **attest**, via
the `z.literal(false)` run-report. A deterministic, saved script is a *stronger*
preventer than prose an LLM re-obeys each run.

---

## Goals

1. Let a dynamic workflow drive the proven one-ticket loop (engineer →
   semantic-verifier → scope-verifier → PM → commit gate) as deterministic JS,
   replacing the LLM-interprets-Markdown choreography.
2. Keep **every consequential boundary** routed through the Forge Core CLI
   (`forge validate / packets / active-ticket / dispatch / guard / parse-agent /
   run-report write`).
3. Move **gate provenance** and **decision-id provenance** fully into Core so no
   orchestration layer (workflow or Markdown) can launder an LLM-supplied value
   into a Core artifact.
4. Define exactly where the human gate physically lives in the workflow model, and
   prove it is at least as strong as today's.
5. Preserve `/forge-run-ticket` as a maintained, portable fallback.
6. Hold the v1 safety thesis verbatim: no auto commit/push/PR/merge, no status
   write-back, no journal write, one ticket per run.

## Non-Goals

- Implementation of any of the above (this is design only).
- A multi-ticket loop, parallel-ticket execution, or any custom orchestration
  engine — dynamic workflows own that lane (audit §What Should Not Be Built).
- Expanding `verify-install` to cover workflow artifacts (deferred per PM until a
  runner artifact exists).
- Making the run-report self-contained / content-addressed (recorded as a future
  design question, not designed here).
- Any of: auto-commit, auto-push, PR automation, merge automation, status
  write-back, journal automation, `run_id`, `attempt_id`, hooks, `doctor`,
  `init-target`, installer/plugin, CI. (See Future Work if any later proves useful.)

---

## Current Architecture Problem

The proven loop is encoded as a ~140-line Markdown procedure
(`commands/forge-run-ticket.md`) that an LLM interprets at runtime. The audit
established this is the project's only non-deterministic surface and that two
"Core-pinned" values are actually flag-trusted:

1. **Gate.** `forge run-report write` takes `--gate-declared/effective/human-required`
   (`src/run-report/cli.ts:130-165`). The source of truth is Core's
   `generateRunPackets` → dry-run → `active_run.gate` (`src/orchestrator/packets.ts:196`),
   but the orchestrator captures and re-passes it (`commands/forge-run-ticket.md:41-45`),
   and the assembler's `HUMAN_GATE_MISMATCH` compares the PM's emitted value against
   that *orchestrator-supplied flag* (`src/run-report/assemble.ts:107`). Core cannot
   cross-reference, because `active-ticket.json` **deliberately omits the gate**
   (`src/cli/active-ticket.ts:10-11` comment). Risk: feeding the PM's own value into
   `--gate-human-required` makes the check tautological — PR #6's bug, one layer up.

2. **Decision id.** `nextDecisionId` is pure, deterministic, tested
   (`src/orchestrator/decision-id.ts:18`) but **has no CLI command** — the orchestrator
   computes the next id by interpreting prose (`commands/forge-run-ticket.md:77-79`)
   and passes `--assigned-decision-id`. Core cross-checks the PM *echo*
   (`src/cli/run.ts:256-276`) and the *format*, never the *computation*, and
   `DecisionsLedgerSchema` enforces no uniqueness/monotonicity
   (`src/orchestrator/decisions-ledger.ts:29-31`).

Both are values **Core could own but chose to accept as flags.** The runtime facts
(`--checkpoint-*`, `--guard-*`, the `OrchestratorConfirmedFacts`) are *not* in this
category — they are observations only the executor can make, and Core validates
their shape (`packets.ts:82-104`); that boundary is correct and stays.

---

## Target Architecture

```
Human approves the workflow at launch
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  Dynamic workflow script  (deterministic JS, saved + reviewed)│
│  - holds the sequence, the correction loop, intermediate vars │
│  - has NO direct shell/fs; dispatches agents for all work     │
│  - contains NO outward-action stage (no commit/push/PR/merge) │
└─────────────────────────────────────────────────────────────┘
        │ dispatches agents:
        ├─ core-runner agent  → runs `forge <cmd>` in repo_root, returns stdout/exit
        ├─ engineer agent     → edits allowed_paths, runs verify_commands
        ├─ semantic-verifier  → acceptance vs repo reality (read-only)
        ├─ scope-verifier     → diff in-fence (read-only)
        └─ pm agent           → PASS / CORRECT / ESCALATE
        │
        │ every consequential boundary is a Core CLI call (via core-runner):
        │   forge validate · run --dry-run · packets · active-ticket
        │   guard paths · parse-agent · run-report write
        │
        ▼
Returns the Core-owned run-report  (PASS + commit-gate materials, or ESCALATE)
        │
        ▼
Human reviews the report and performs the outward action (commit/push/PR)
```

**Critical workflow-mechanics constraint** (from the feature docs, researched
2026-05-28): *the workflow script itself has no direct filesystem or shell access —
agents read, write, and run commands; the script coordinates.* Therefore every
`forge` CLI invocation and every git read happens **inside a dispatched agent**, and
the script holds only the structured results in variables. This is a feature, not a
limitation: deterministic JS data-flow between stages replaces LLM-narrated control
flow.

**core-runner agent (new role, design):** a thin utility agent whose only job is to
run a specified `forge` subcommand (or a read-only git command) from the pinned
`repo_root` and return `{exit, stdout}` under a strict schema. The script
`JSON.parse`s stdout where the command emits JSON. This keeps Core behind an agent
(required) while the *values* live in script variables the script controls.

---

## Human-Gate Enforcement Model

This is the load-bearing section. The honest answer from the audit: **Core attests;
it does not prevent.** That does not change. What changes is *where prevention
lives*, and it gets stronger.

**Where the gate physically lives in the workflow model — three substrate
properties, none of which is Core:**

1. **The workflow script contains no outward-action stage.** There is literally no
   `agent(...)` call in the script that runs `git commit`, `git push`, `gh pr
   create`, or `git merge`. The script's terminal stage runs `forge run-report
   write` (via core-runner) and returns the report. Because the script is a
   **saved, reviewed artifact** (`.claude/workflows/…`), this "no outward call"
   property is statically auditable — strictly stronger than an LLM re-reading *"Do
   NOT commit. Stop."* (`commands/forge-run-ticket.md:131`) each run.

2. **The tool allowlist denies outward tools to the workflow's agents.** Workflow
   subagents inherit the session tool allowlist and run in `acceptEdits`. The
   engineer agent needs to edit `allowed_paths` and run `verify_commands`; **no
   agent in this design needs `git commit`/`git push`/`gh`.** (Even scope checking
   uses read-only `git status`, `src/guard/git.ts`.) Outward tools must be excluded
   from the allowlist for the run. **(hypothesis: the exact allowlist mechanism for
   constraining a workflow's agents needs confirmation against the runner UX; the
   principle is firm.)**

3. **The human approves at launch and at the report.** The workflow launch prompt
   is the entry gate; the returned run-report is the exit gate; the human performs
   the outward action manually. This matches today's commit-gate shape.

**Core's role (unchanged, durable KEEP):** attestation. `forge run-report write`
records `safety.* = z.literal(false)` (`src/run-report/schema.ts:104-113`) and the
assembler rejects `facts.final_branch_status.committed === true`
(`src/run-report/assemble.ts:214`). Core cannot prevent a git call — it is a CLI
that writes JSON — but it produces the typed, byte-deterministic proof that the gate
held.

**"No mid-run user input" is compatible.** The correction loop is already
human-free mid-ticket (PM `CORRECT` → re-dispatch engineer, cap 3,
`commands/forge-run-ticket.md:108-109`); ESCALATE simply ends the run and returns
the evidence report. The only human checkpoints are launch and the final report —
exactly the v1 model.

**Verdict:** the human-gate model is **durable if adapted** (audit §Human-Gate).
The attestation half is unchanged Core; the enforcement half moves from "LLM obeys
prose" to "reviewed script with no outward stage + allowlist denial + human at the
ends," which is a net strengthening.

---

## Gate Provenance Design

**Objective:** the effective gate flows Core-file → Core-file; no orchestration
layer re-types it.

**Change:** make the gate a first-class field of the Core-emitted active-ticket
artifact, and have the run-report writer read it from there.

1. Extend `ActiveTicketSchema` (`src/guard/active-ticket.ts:20-32`) with an optional
   `gate: { declared, effective, human_required }` object. The schema is already
   intentionally non-strict and tolerant of operational fields the guard ignores
   (`active-ticket.ts:10-19`), so the guard is unaffected.
2. `buildActiveTicket` (`src/cli/active-ticket.ts:12-23`) emits `gate` from
   `activeRun.gate` (it already has it; today it explicitly drops it). One added
   field; no shape change for the guard.
3. `forge run-report write` (`src/run-report/cli.ts`) reads the gate from the
   active-ticket file it **already loads** (`run-report/cli.ts:224-231`) and feeds it
   to the assembler's `runtime.effective_gate`. The `--gate-*` flags become either
   (a) removed, or (b) an *optional cross-check* that must equal the active-ticket
   gate (mismatch → typed failure). **Recommendation: keep them as an optional
   cross-check during migration, then remove** — so the assembler's
   `HUMAN_GATE_MISMATCH` (`assemble.ts:107`) compares the PM's value against a
   genuinely Core-sourced gate, not an orchestrator flag.

**Result:** `forge packets`/dry-run computes the gate → `forge active-ticket`
persists it → `forge run-report write` reads it. The gate never transits the
workflow script or an agent's re-typing. Closes audit §Trust Boundary §1 under any
substrate.

---

## Decision-ID Provenance Design

**Objective:** Core assigns, renders, and appends the decision id; the orchestration
layer never computes it.

**Is duplication possible in normal current Markdown runs? — Yes, in principle.**
Nothing in Core enforces it: the orchestrator computes the next id from prose
(`commands/forge-run-ticket.md:77-79`), Core checks only the PM *echo*
(`src/cli/run.ts:256-276`), and `DecisionsLedgerSchema` has no uniqueness or
monotonicity constraint (`src/orchestrator/decisions-ledger.ts:29-31`), so
`appendDecision` (`decisions-ledger.ts:91-107`) will write a duplicate without
objection. A miscount by the orchestrator (LLM arithmetic) would silently produce a
colliding id. The designed `D-001` reuse across ESCALATE-recovery attempts (separate
archived ledgers) is intentional and *not* this case. **This meets the PM's stated
exception criterion for an immediate standalone hardening ticket — flagged for the
PM's decision (see Open Questions).**

**Change:**

1. **Core assigns the id.** `forge dispatch pm` (`src/cli/run.ts:104-205`,
   `buildPmDispatch` in `src/orchestrator/dispatch.ts:253-302`) has the epic path, so
   it can read `decisions-ledger.json` and call `nextDecisionId()`
   (`src/orchestrator/decision-id.ts:18`) **internally**, rendering the assigned id
   into the PM packet's authoritative section (`dispatch.ts:145-150`). The
   `--assigned-decision-id` flag downgrades from *source* to *optional cross-check*
   (or is removed). This requires `dispatch pm` to read the ledger via the existing
   `DecisionsLedgerIo` seam (`decisions-ledger.ts:41-46`).
2. **Core enforces ledger integrity.** Add a `.superRefine()` to
   `DecisionsLedgerSchema` requiring `decision_id`s be unique and monotonically
   increasing within the active ledger, so `appendDecision` rejects a duplicate or
   regression (`LEDGER_INVALID`/`LEDGER_ENTRY_INVALID`). Per-attempt reset stays by
   design — uniqueness is within the active ledger only.
3. **Echo cross-check stays.** `forge parse-agent pm --expected-decision-id`
   (`run.ts:256-276`) continues to verify the PM emitted the Core-assigned value
   verbatim.

**Result:** assignment, rendering, append, and integrity are all Core. The
orchestration layer (workflow or Markdown) only triggers the sequence. Closes audit
§Trust Boundary §2 under any substrate.

**Surface decision:** prefer **folding assignment into `forge dispatch pm`** over
adding a separate `forge next-decision-id` command — fewer CLI surfaces, and it
keeps assignment atomic with dispatch. (Open Question.)

---

## Workflow Script Responsibilities

The script is deterministic orchestration JS. It:

- Runs **preflight** via core-runner: `forge validate`, `forge run --dry-run`;
  dispatches a read-only git check for a clean tree; checks `.forge/lock.json`.
- Gets **packets** via `forge packets` (carries `active_run.gate`); writes the
  **lock** and the **active-ticket** (`forge active-ticket`, now gate-bearing) via
  an agent. Records the checkpoint `{base, HEAD}`.
- Creates the **branch** via a dispatched git agent (read/write but no commit/push).
- Dispatches **engineer**, runs **verify_commands** independently (core-runner /
  engineer-independent), runs **`forge guard paths`**, dispatches **semantic** then
  **scope** verifiers; validates every agent output via `forge parse-agent`.
- Runs the **PM** via `forge dispatch pm` (Core assigns the id) → captures →
  `forge parse-agent pm --expected-decision-id`.
- Holds the **correction loop** (PM `CORRECT` → re-dispatch engineer, cap 3) as a
  JS loop with a counter — no human input needed (matches "no mid-run input").
- On PASS/ESCALATE, calls **`forge run-report write`** (gate now Core-sourced) and
  **returns the report** as the workflow's single answer. Releases the lock.

The script **never** dispatches an agent that commits, pushes, opens a PR, merges,
writes status, writes a journal, or edits contract/manifest/governance files.

---

## Forge Core Responsibilities

Unchanged trust root (all KEEP per the audit), now the sole owner of gate +
decision-id provenance:

- **Contract validation** — `forge validate` (`src/validate/validate-contract.ts`).
- **Ticket selection + packets** — `forge packets` (`src/orchestrator/packets.ts`),
  pins absolute `repo_root` + cwd discipline (`packets.ts:172-184`).
- **Active-ticket fence (now gate-bearing)** — `forge active-ticket`
  (`src/cli/active-ticket.ts`, `src/guard/active-ticket.ts`).
- **Deterministic scope gate** — `forge guard paths`
  (`src/guard/path-guard.ts:61`, `guard/cli.ts`).
- **Never-repair agent validation** — `forge parse-agent`
  (`src/agents/parse-output.ts`).
- **Decision-id assignment + ledger integrity** — `forge dispatch pm`
  (`src/orchestrator/dispatch.ts`, `decision-id.ts`, `decisions-ledger.ts`).
- **Typed, byte-deterministic attestation** — `forge run-report write`
  (`src/run-report/**`), `safety.*: z.literal(false)`.

---

## Markdown Orchestrator Fallback

`/forge-run-ticket` (`commands/forge-run-ticket.md`) **stays as a maintained,
portable fallback** for runtimes without dynamic workflows (which are paid-plan,
research-preview, token-heavy per the audit). It benefits from the same provenance
fixes for free: once Core sources the gate from the active-ticket and assigns the
decision id internally, the Markdown procedure's step-2 gate capture and step-9
id-computation prose can be simplified to "let Core decide," removing its two
sharpest seams. **Do not sunset it** until the workflow runner proves out on **one
self-run and one external safe target** (PM condition). Future state: workflow
runner = preferred; Markdown = fallback; Core = trust root for both.

---

## Required Core Changes

All small, all TDD-able, all preserve strict/never-repair. Each is a normal gated
ForgeGate ticket in Phase B (not now).

| # | Change | Files | Risk |
|---|---|---|---|
| C1 | Add optional `gate` to active-ticket schema + emit it | `src/guard/active-ticket.ts`, `src/cli/active-ticket.ts` | low; guard tolerant of extra fields already |
| C2 | `run-report write` reads gate from active-ticket; `--gate-*` → optional cross-check | `src/run-report/cli.ts`, `src/run-report/assemble.ts` | low; cross-check preserves `HUMAN_GATE_MISMATCH` semantics |
| C3 | `dispatch pm` assigns id via `nextDecisionId` from the ledger; `--assigned-decision-id` → optional cross-check | `src/cli/run.ts`, `src/orchestrator/dispatch.ts` | medium; touches the PM dispatch path |
| C4 | Ledger uniqueness/monotonicity refinement | `src/orchestrator/decisions-ledger.ts` | low; additive `.superRefine()` |
| C5 | core-runner agent charter (utility role) | `agents/` (new charter) | low; new agent definition |

C1–C4 strengthen Core under **both** substrates and are the "fold-in" hardening the
PM approved. C5 is workflow-specific.

---

## Required Workflow Artifact

A **saved, reviewed** workflow script (proposed `.claude/workflows/forge-run-ticket.workflow.js`),
with a `meta` block and phases mirroring the procedure (Preflight, Engineer,
Verify+Guard, Verifiers, PM, Commit-Gate). It must be a checked-in, reviewed artifact
— **not an ad-hoc generated workflow** — so the "no outward-action stage" property is
auditable and the script is reproducible. Naming, location (project
`.claude/workflows/` vs. shipped with the package), and how it is distributed to
adopters are Open Questions.

---

## Safety and Failure Modes

- **Provenance laundering (primary risk).** An agent could misreport a Core value
  back to the script. *Mitigation:* after C1–C4, gate and decision-id flow
  Core-file → Core-file and never transit the script or an agent's re-typing, so a
  misreport cannot affect them. The only values the script passes are runtime facts
  Core cannot observe (checkpoint SHAs, guard exit) — the same boundary as today
  (`packets.ts:82-104`).
- **Accidental outward action.** *Mitigation:* reviewed script with no outward stage
  + allowlist denial of push/PR tools + human at launch/report. Three independent
  controls.
- **No mid-run human input.** *Mitigation:* correction loop is already automated;
  ESCALATE ends the run and returns evidence. Human checkpoints are launch + report.
- **Cross-session interruption.** Workflows resume only within a session; an
  interrupted run restarts fresh. *Mitigation:* `.forge/lock.json` halts a fresh
  start (`LOCK_EXISTS`) until the human clears it (`forge-run-ticket.md:40`), and
  prior `.forge/` evidence is preserved per the escalate-attempt ritual. The restart
  must be idempotent — design the script to refuse a dirty/locked restart, never to
  silently re-run.
- **Token cost.** Workflows are token-heavy, but a ForgeGate run is ~4 charter
  agents + a handful of core-runner calls — modest versus a 100-agent sweep. Note
  for adopters; not a blocker.
- **Determinism.** Workflow *results* are non-deterministic, but ForgeGate's *gates*
  are deterministic Core; non-determinism is confined to agent work, which the
  deterministic guard + never-repair validation + typed report catch. This is the
  whole point of the split.

---

## Migration Plan

- **Phase A — Design (this doc).** PM review.
- **Phase B — Core hardening (gated tickets).** C1–C4 as normal TDD ForgeGate
  tickets through `/forge-run-ticket` itself (frozen-build discipline). These ship
  independently of the workflow and strengthen the Markdown fallback.
- **Phase C — Workflow runner (gated ticket + C5).** Build the saved workflow script
  + core-runner charter. Prove on **one self-run** and **one external safe target**
  (PM condition) before promotion.
- **Phase D — Promotion.** Workflow runner = preferred substrate; `/forge-run-ticket`
  = maintained fallback; Core = trust root for both. No sunset of the fallback.
- **Adversarial pass (PM-gated, after this design):** targeted review of one
  question — *can the workflow-backed runner bypass the human gate or launder
  LLM-supplied provenance into Core artifacts?*

---

## Open Questions

1. **Decision-id exception.** Duplication *is* possible in normal current Markdown
   runs (shown above: no Core uniqueness enforcement; orchestrator computes from
   prose). Per your stated exception, do you want **C3+C4 split out as an immediate
   standalone Core hardening ticket** now, or kept folded into Phase B? My lean:
   C4 (ledger uniqueness refinement) is a tiny, substrate-independent safety net
   worth landing immediately; C3 (Core-assigns) folds into Phase B with the gate
   work. Splitting just C4 out gives insurance without pre-empting the design.
2. **Flag fate.** For C2/C3, keep `--gate-*` and `--assigned-decision-id` as
   optional cross-checks permanently (defense in depth) or remove them once Core is
   the source? My lean: keep as optional cross-check; never as source.
3. **Decision-id surface.** Fold assignment into `forge dispatch pm` (preferred,
   fewer surfaces) or add `forge next-decision-id <epic>`?
4. **Workflow allowlist mechanism.** Confirm how a saved workflow constrains its
   agents' tool allowlist to deny outward tools. **(hypothesis-dependent.)**
5. **Workflow distribution.** Project-local `.claude/workflows/` vs. shipped with the
   package for adopters — affects `verify-install`'s eventual scope (deferred).
6. **Future work (not now, listed because they may resurface):** run-report
   self-containment (hashes/embedded outputs); whether the Markdown fallback is
   eventually retired. None designed here.
