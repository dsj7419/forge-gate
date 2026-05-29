# Workflow-Era ForgeGate Architecture Audit

> Read-only architecture audit. Author: incoming senior engineer, 2026-05-28.
> Scope authorized by the PM (Dan): classify every major ForgeGate component as
> KEEP / ADAPT / RETIRE / DEFER against the question — *what remains durable if
> Claude Code dynamic workflows become the execution substrate?* No source,
> contract, command, or README edits; no epic, branch, commit, push, or PR; no
> implementation. This document is the only artifact produced.
>
> Evidence is cited inline by path (and line where stable). Claims I could not
> fully prove from the code are labelled **(hypothesis)**.

---

## Executive Verdict

Dynamic workflows do **not** obsolete ForgeGate. They obsolete exactly one thing:
**the long Markdown `/forge-run-ticket` procedure as the best execution
substrate.** Everything that gives ForgeGate its trust claim lives in Forge Core
(`src/`), and Core is a runtime-agnostic CLI that composes *inside* a workflow as
cleanly as it sits under a Markdown command.

The audit confirms the strategic reframe: **ForgeGate should become the
deterministic governance/attestation layer that any execution substrate — Claude
Code, a dynamic workflow, CI, or a human — drives.** The orchestration mechanics
(fan-out, sequencing, retries) are now commodity and should not be built here. The
governance contract (typed never-repair validation, path fences, the
`z.literal(false)` run-report, the human gate) is not commodity, and dynamic
workflows *raise* its value by making ungated autonomy cheap and default.

**The single most important finding, and a direct challenge to the expected
classification:** the human-gate model is **NOT unconditionally durable**. Core
**attests** that no outward action happened; it does **not prevent** one. Today,
prevention lives in the orchestrator LLM obeying the prose "Do NOT commit. Stop."
(`commands/forge-run-ticket.md:131`) plus the harness auto-mode classifier —
**neither is Core.** Under a workflow substrate (subagents auto-edit, no mid-run
human, agents can call `git`/`gh` if allow-listed), that procedural enforcement
must be deliberately relocated or the gate weakens. The good news: a deterministic
workflow *script* that simply contains no outward call is a **stronger** enforcer
than prose an LLM must re-obey each run — but only if built that way.

A second finding reinforces the same pattern: two values ForgeGate calls
"Core-pinned" — the **effective gate** and the **monotonic decision id** — are
actually *computed by Core's logic but routed through the LLM orchestrator as CLI
flags*, and Core validates only their **format/echo, not their provenance**. The
workflow migration is the natural, low-cost moment to close both seams.

---

## What Dynamic Workflows Obsolete

Confirmed against the official feature docs (researched 2026-05-28) and the
ForgeGate code:

1. **The Markdown orchestrator as execution substrate.** `/forge-run-ticket` is a
   ~140-line procedure (`commands/forge-run-ticket.md`) an LLM interprets at
   runtime — the project's only non-deterministic surface and the one the handoff
   and onboarding both already flagged. A dynamic workflow is deterministic
   JavaScript the runtime executes: real control flow, real error handling, real
   resume. For the *mechanical* parts of the loop (sequence dispatch → verify →
   PM, capture outputs to paths, run the correction loop to a cap), the workflow
   substrate is strictly better.

2. **Any ambition to build our own multi-agent orchestration.** Parallel
   subagent fan-out, multi-ticket loops, scheduling, subagent-coordination
   primitives — dynamic workflows own this lane now (tens-to-hundreds of agents,
   adversarial verify, judge panels, loop-until-dry, resumable). ForgeGate only
   ever had four *fixed serial* agents (`src/orchestrator/dispatch.ts`); competing
   on orchestration was never the moat and is now a losing race against a
   first-party platform.

3. **Hand-rolled "verification by independent agents" as a differentiator.** The
   engineer → semantic-verifier → scope-verifier → PM chain is a good pattern, but
   "independent agents that try to refute each other" is now a built-in workflow
   capability. ForgeGate's verifiers stay valuable only because they are bound to a
   *contract* and feed a *typed artifact* — not because the fan-out itself is special.

What is **not** obsoleted: see the next section.

---

## What Dynamic Workflows Make More Valuable

Dynamic workflows have, per the official docs (researched 2026-05-28):

- **Auto-approved file edits** — workflow subagents always run in `acceptEdits`,
  regardless of session mode.
- **A single human gate at launch**, and **no mid-run user input**; in
  bypass/headless modes, no gate at all.
- **No determinism** — same task twice diverges; only the *script* is repeatable,
  not the *result*.
- **No typed/immutable safety or evidence artifact**, and an incomplete post-hoc
  audit trail. Verification is LLM-vote, not schema.

Every one of those is a gap ForgeGate Core already fills, and the gaps get more
expensive as autonomy scales:

1. **Deterministic, typed, byte-identical evidence.** `forge-run-report/v1`
   (`src/run-report/schema.ts`) is `.strict()`, and every `safety.*` boolean is
   `z.literal(false)` (`schema.ts:104-113`) — commit/push/PR/merge/status-write-back/
   journal cannot even be *represented* as true without a deliberate v2 bump. The
   writer is byte-deterministic (`run-report/cli.ts:270-275`). Workflows produce
   "a coordinated answer"; they cannot produce this.

2. **Never-repair, schema-validated agent I/O.** `parseAgentOutput`
   (`src/agents/parse-output.ts`) rejects malformed/prose-only output as
   `AGENT_OUTPUT_INVALID` and never coerces. "Stop loudly" beats a workflow's
   "improvise plausibly" for high-trust/client work.

3. **A deterministic, runtime-agnostic scope gate.** `evaluateFence`
   (`src/guard/path-guard.ts:61`) + `REPO_ROOT_MISMATCH` (`path-guard.ts:64`) is a
   pure, no-LLM checker that a workflow stage can shell out to. The more
   autonomous the editor, the more an *external* deterministic fence is worth.

4. **Provenance/attestation primitives** — the decision ledger
   (`src/orchestrator/decisions-ledger.ts`) and the run-report give a signable,
   replayable record of "what was authorized," which workflows structurally lack.

Net: workflows are the throughput engine; ForgeGate is the trust boundary. The
launch is a forcing function that *clarifies* the product, not a competitor.

---

## KEEP / ADAPT / RETIRE / DEFER Classification

| Component | Evidence | Verdict | Rationale |
|---|---|---|---|
| **Contract validation** | `src/validate/validate-contract.ts`, `load.ts`, `integrity.ts`, `readiness.ts` | **KEEP** | Pure, deterministic, read-only; substrate-independent. A workflow calls `forge validate` unchanged. |
| **Path-fence guard** | `src/guard/path-guard.ts`, `guard/cli.ts`, `guard/git.ts` | **KEEP** | Crown-jewel deterministic gate. Runtime-agnostic; composes as a workflow stage. The most valuable single piece in the workflow era. |
| **parse-agent + strict schemas** | `src/agents/parse-output.ts`, `agents/schemas.ts` | **KEEP** | Never-repair typed validation. Equally callable from a workflow; the discipline workflows lack. |
| **Run-report writer + schema** | `src/run-report/**` | **KEEP** | The trust artifact. `safety.*: z.literal(false)` is the v1 thesis in types. The audit/attestation root of the whole product. |
| **Decision-id allocator + ledger** | `src/orchestrator/decision-id.ts`, `decisions-ledger.ts` | **ADAPT** | Modules are durable, but enforcement is incomplete: `nextDecisionId` is not CLI-exposed (orchestrator computes by prose), and the ledger schema enforces no uniqueness/monotonicity (`decisions-ledger.ts:29-31`). See Trust Boundary §2. |
| **active-ticket artifact** | `src/cli/active-ticket.ts`, `guard/active-ticket.ts` | **ADAPT** | Core-emitted, schema-validated — KEEP the artifact. But it *deliberately omits the gate* (`cli/active-ticket.ts:10-11` comment), which is the gate-provenance seam. Adapting it to carry the Core-derived gate lets Core, not a flag, be the gate's source for the run-report. |
| **Dispatch packets + buildPmDispatch** | `src/orchestrator/packets.ts`, `dispatch.ts` | **KEEP** | Deterministic prompt generation that pins absolute `repo_root` + cwd discipline (`packets.ts:172-184`). A workflow still calls `forge packets` / `forge dispatch <role>` to get non-improvised prompts. |
| **Agent charters** | `agents/forge-*.md` | **KEEP** | Role contracts; substrate-independent. A workflow injects them the same way the fallback path does today (`dispatch.ts:208-214`). |
| **verify-install** | `src/install/**` | **ADAPT** | Concept is durable (install-drift is real), but it verifies the *installed Markdown commands + charters* (`install/cli.ts:67-71`). If the orchestrator becomes a saved workflow script, the currency surface shifts; verify-install should grow to cover the workflow-era artifact set. **(hypothesis — depends on how the runner is packaged.)** |
| **Escalation matcher** | `src/validate/escalation.ts` | **KEEP** | Contract-time validation, substrate-independent. The negation-blindness (`escalation.ts:7-17`) is a known low-priority UX item, unrelated to workflows; do not touch without a go. |
| **Markdown `/forge-run-ticket` (governance calls)** | `commands/forge-run-ticket.md` steps that call `forge validate/packets/active-ticket/guard/parse-agent/run-report` | **KEEP (as Core CLI calls)** | These delegate to Core and are the durable spine. They survive verbatim inside a workflow script. |
| **Markdown `/forge-run-ticket` (choreography)** | `commands/forge-run-ticket.md` steps 3–9 sequencing, capture-to-path, correction loop | **RETIRE (eventually)** | The LLM-interprets-prose execution model. Replace with a deterministic workflow script once one proves out. Keep as fallback until then (portability). |
| **Manual shell choreography / wrapper ceremony** | `scripts/run-forge-cli.mjs` resolver, per-step Bash in the command | **ADAPT / TRANSITIONAL** | The CLI resolver stays useful anywhere; the hand-run Bash sequencing folds into the workflow script. |
| Multi-ticket / parallel fan-out / workflow engine / scheduling | — | **RETIRE (do not build)** | Workflows own this lane. |
| Hooks, doctor, init-target, installer/plugin, CI, status write-back, journal automation, `run_id`, `attempt_id`, auto-commit/push/PR/merge | — | **DEFER** | Future capability; explicitly **not next**. Listed here only to mark them as out of scope, per the standing rules. |

---

## Human-Gate Survival Analysis

This is the primary pressure test. Answered precisely; the expected
classification ("durable") is **challenged**.

### Where does the human gate physically live today?

There are two layers, and **only one of them is Core**:

1. **Prevention (procedural, NOT Core).** What actually stops a commit/push/PR/
   merge is the orchestrator LLM obeying prose: *"**Do NOT commit.** Stop."*
   (`commands/forge-run-ticket.md:131`), reinforced by the v1 hard-constraints
   block (`forge-run-ticket.md:27-33`) and the design docs
   (`docs/one-ticket-orchestration-design.md` §10, `docs/forge-run-ticket-design.md`
   §11). The secondary backstop is the **harness auto-mode classifier** (blocks
   direct push to `main`, `git push origin --delete`, some compound git) — also
   external to Core.

2. **Attestation (Core).** `forge run-report write` records `safety.* = false`
   and the assembler re-checks the *facts* it was given, rejecting
   `facts.final_branch_status.committed === true` (`src/run-report/assemble.ts:214`).
   But this is a check on **reported facts**, written **after** the run. Core is a
   CLI that emits a JSON file; **it has no control over what git commands the
   orchestrator runs.** It cannot prevent a commit — it can only refuse to *attest*
   one and, if told one happened, refuse to write a PASS report.

**Conclusion:** today the gate is *prevented* by procedure + harness and *attested*
by Core. Core never was the preventer. This is the same orchestrator→Core
provenance seam flagged at onboarding, now shown to be load-bearing for the whole
strategy.

### If a dynamic workflow becomes the orchestrator, what still enforces the gate?

Workflow facts that matter: subagents auto-edit (`acceptEdits`), there is no
mid-run human, and agents can run `git`/`gh` if those tools are allow-listed.

- **Auto-edit is fine.** The engineer agent is *supposed* to edit within
  `allowed_paths`; the deterministic guard (`forge guard paths`) + scope-verifier
  catch any out-of-fence edit *after the fact*, exactly as today.
- **The outward-action prevention must be relocated** to three places, none of
  which is Core, but all of which are stronger or equal to today's prose:
  1. **The workflow script contains no commit/push/PR/merge call.** Deterministic
     JS that simply never issues an outward command is a **stronger** enforcer than
     an LLM re-reading "Do NOT commit" each run.
  2. **The tool allowlist denies `git push` / `gh pr` / merge tools** to the
     workflow's agents. (Workflow agents inherit the session allowlist; outward
     tools must be excluded.)
  3. **Human approval at workflow launch + on the returned run-report**, then the
     human performs the outward action — the same shape as today's commit gate.
- **Core remains the attestation/audit root** — the run-report is what proves,
  after the fact, that the gate held.

### Classification of the human-gate model

**DURABLE IF ADAPTED** — not unconditionally durable.

- The **attestation half** (`safety.*: z.literal(false)`, the committed re-check)
  is **KEEP** — fully durable, substrate-independent.
- The **enforcement half** is **transitional**: it moves from "LLM obeys Markdown
  prose" to "deterministic script issues no outward call + allowlist denies the
  tools." A workflow can make the gate *stronger*, but the gate is a property of
  the **execution harness**, not of Core, and that must be stated honestly.

**Reframe for the product story:** *ForgeGate does not prevent outward actions; it
refuses to attest them and structures the run so nothing issues them.* Prevention
belongs to the substrate; attestation belongs to Core. That is the durable,
honest line — and it is exactly why composing with workflows (deterministic
scripts) is safer than the current prose-following orchestrator.

---

## Orchestrator-to-Core Trust Boundary Findings

**The pattern:** Core owns the deterministic *logic*, but for some values the
*enforcement path* routes that value through the LLM orchestrator as a CLI flag,
and Core validates only **format or echo, not provenance**. Two instances, both
closable by the workflow migration.

### §1 — Effective gate (the relocated PR #6 risk)

| Aspect | Finding |
|---|---|
| Flags | `--gate-declared`, `--gate-effective`, `--gate-human-required` (`run-report/cli.ts:130-165`) |
| Source of truth | Core: `generateRunPackets` → `runDryRun` → `active_run.gate` (`packets.ts:196`) |
| Who computes | Core (in `forge packets` / dry-run) |
| Who passes | The **orchestrator LLM**, from its step-2 capture (`forge-run-ticket.md:41-45`) |
| Who validates | `run-report write` checks only enum/boolean *shape*; the assembler's `HUMAN_GATE_MISMATCH` compares the PM's emitted value against the **orchestrator-supplied flag** (`assemble.ts:107`) |
| Can Core verify provenance? | **No.** `active-ticket.json` deliberately omits the gate (`cli/active-ticket.ts:10-11` comment), so the run-report has no Core-owned artifact to cross-reference. |
| Risk if passed wrong | If the orchestrator feeds the PM's *own* emitted value into `--gate-human-required`, the mismatch check becomes **tautological** — the exact PR #6 bug, relocated one layer up where Core can't see it. |
| Would a workflow help? | **Yes.** A deterministic script reads the gate from `forge packets` JSON and passes it with code-level provenance; better still, Core could read the gate from a Core-owned artifact in `run-report write` and stop accepting it as a flag. |

### §2 — Monotonic decision id

| Aspect | Finding |
|---|---|
| Flags | `--assigned-decision-id` (dispatch pm), `--expected-decision-id` (parse-agent pm) |
| Source of truth | `nextDecisionId(existing)` — pure, deterministic, tested (`decision-id.ts:18`) |
| Who computes | **The orchestrator LLM**, by interpreting the prose algorithm in `forge-run-ticket.md:77-79`. **There is no `forge next-decision-id` CLI command** (confirmed: no such entry in `src/cli/run.ts` USAGE or router). The deterministic allocator is in the library but **not on the enforcement path.** |
| Who validates | Core cross-checks that the PM *echoes* the assigned id (`cli/run.ts:256-276`, `DECISION_ID_MISMATCH`) and validates *format* (`run.ts:139-153`). It does **not** validate that the id is the correct next monotonic value. |
| Ledger integrity | `DecisionsLedgerSchema` enforces no uniqueness or monotonicity (`decisions-ledger.ts:29-31`); `appendDecision` will write a duplicate/non-monotonic id without objection. |
| Risk if passed wrong | A miscomputed or duplicate id (e.g. `D-001` when the ledger holds `D-001..D-005`) is accepted, echoed, cross-checked OK, and appended — silently breaking the provenance guarantee the feature exists to provide. |
| Would a workflow help? | **Yes.** Either expose `forge next-decision-id <epic>` and have the script call it, or (better) have `forge dispatch pm` read the ledger and compute the id itself, plus a ledger-uniqueness refinement. Moves provenance fully into Core. |

### Flags that are legitimately orchestrator-asserted (not seams)

`--checkpoint-base/head`, `--guard-result/exit`, and the `facts`
(`final_changed_files`, `verify_command_results`, `final_branch_status`) are
**genuine runtime observations only the executor can make** — it ran git and the
verify commands. Core validates their *shape* (`OrchestratorConfirmedFactsSchema`,
`packets.ts:82-104`) and that is the right boundary. The distinction matters: the
gate and decision-id are values **Core could compute itself but chose to accept as
flags**; these others are facts Core cannot independently observe. Only the former
are provenance gaps worth closing.

---

## Workflow-Backed ForgeGate Target Architecture

**Shape:** *dynamic workflow = execution engine; Forge Core = deterministic
gate/checkpoint engine.*

```
Human approves launch
        │
        ▼
Dynamic workflow script  ── drives sequence, dispatches the 4 charter agents,
   (deterministic JS)        runs verify_commands, captures raw outputs
        │
        │  at every consequential boundary, shells out to Core:
        ├─ forge validate <epic>            (preflight)
        ├─ forge active-ticket <epic>       (Core-emitted fence)
        ├─ forge guard paths --active ...   (deterministic scope gate)
        ├─ forge parse-agent <role> ...     (never-repair typed validation)
        ├─ forge run-report write ...       (typed, byte-deterministic attestation)
        └─ forge verify-install             (preflight currency)
        │
        ▼
Returns the Core-owned run-report as its one coordinated answer
        │
        ▼
Human reviews the report, performs the outward action (commit/push/PR)
```

**The workflow MUST:**
- Stop before any outward action; return the run-report as its final output.
- Route every consequential boundary through the Core CLI (above).
- Pin absolute `repo_root` into every agent dispatch (the run-#1 lesson,
  `one-ticket-orchestration-design.md` §14).

**The workflow MUST NEVER:**
- Commit, push, open a PR, merge, write status back, or write a journal —
  enforced by the script issuing no such call **and** by the tool allowlist
  denying outward tools to its agents.
- Expand autonomy beyond a single ticket without an explicit human-approved
  scope/schema change.

**Where Core gets stronger in this model:** closing the two provenance seams
(§Trust Boundary) so the gate and decision-id are Core-sourced, not flag-trusted —
which is *easier* to do from a deterministic script than from prose.

**Portability caveat:** dynamic workflows are paid-plan, research-preview,
token-heavy. The Markdown orchestrator should remain a maintained **fallback** for
runtimes without workflows; the `forge` CLI runs anywhere regardless. Do not make
the workflow runner the *only* path.

---

## Recommended Next Ticket

Per the decision bar (no implementation unless small, clear, and trust-tied), and
the phased plan (forensics → design → prototype), the recommended next step is
**Phase 2: a design doc, not code** — `docs/workflow-backed-runner-design.md`,
specifying the workflow-backed runner above for PM review before any prototype.

Two **candidate** Core-hardening tickets surfaced by this audit are each small,
clear, and directly trust-tied, and could land *independently* of the workflow
migration because they strengthen Core under any substrate. **Flagging as
candidates only — not approved, not next without a go:**

1. **Decision-id provenance** *(candidate)* — expose `forge next-decision-id`
   (or compute inside `forge dispatch pm`) + add a ledger uniqueness/monotonicity
   refinement (`decisions-ledger.ts`). Closes §2.
2. **Gate provenance** *(candidate)* — carry the Core-derived gate in the
   active-ticket artifact and have `run-report write` read it from there instead
   of trusting the `--gate-*` flags. Closes §1 and the relocated PR #6 risk.

My recommendation: **Phase 2 design doc next.** Decide the two hardening
candidates as part of that design (they are the workflow runner's trust
foundation), rather than as standalone tickets ahead of it — unless you want one
landed now as immediate insurance.

---

## What Should Not Be Built Anymore

- A custom parallel/multi-agent orchestration engine, multi-ticket loops, workflow
  scheduling, or subagent-coordination primitives — **dynamic workflows own this.**
- Anything that *grows* the Markdown orchestrator's responsibilities; it is a
  transitional shell, not a place to invest.
- Auto commit/push/PR/merge, status write-back, journal automation, `run_id`,
  `attempt_id` — unchanged from the standing v1 boundaries.

Still **DEFER** (future capability, explicitly not next, needs a deliberate scope
discussion): hooks, `forge doctor`, `forge init-target`, installer/plugin, CI.

---

## Open Questions for Dan

1. **Hardening now or in the design?** Should the gate- and decision-id-provenance
   fixes land as small standalone Core tickets *now* (they harden Core under any
   substrate), or be folded into the Phase-2 workflow-runner design as its trust
   foundation? My lean: fold in, unless you want the decision-id fix as immediate
   insurance.
2. **Markdown orchestrator: fallback or sunset?** Keep `/forge-run-ticket` as a
   maintained fallback for non-workflow runtimes (portability), or sunset it once
   the workflow runner proves out? My lean: keep as fallback — portability is part
   of the guarantee.
3. **verify-install scope.** Should it expand to cover a saved workflow script's
   currency, or is that premature until the runner exists? **(hypothesis: premature
   until Phase 3.)**
4. **Run-report self-containment.** `agent_outputs` stores *paths* into gitignored
   `.forge/` (`run-report/assemble.ts:66-71`, `176`), so the evidence is only as
   durable as `.forge/` (preserved today by the manual `escalate-attempt<N>/`
   ritual). Should the workflow era make the report self-contained — embed or hash
   the captured outputs — so evidence survives `.forge/` cleanup without a manual
   step?
5. **Scope of any adversarial second pass.** This was a focused single-engineer
   audit. If any finding above (most likely the human-gate enforcement relocation)
   warrants independent adversarial verification, that is the place to spend a
   targeted multi-agent review — not a broad one.
