# Discovery — workflow role-output persistence seam

> **Status: discovery only — read-only inspection, no contract, no code.** Investigates **F1** from
> `docs/workflow-launch-operability-finding.md`: the Claude Code auto-mode classifier denied the
> `forge-core-runner` bridge persisting the scope-verifier's APPROVE verdict into `.forge/`, treating it as
> verification stamping. Proof context: `run_id bef9af6c-d14a-4701-9cee-e286ace00730`, workflow run
> `wf_0c098781-275`, classification `PARTIAL_OPERABILITY_CONFIRMED_WITH_BLOCKERS`. Candidate directions below are
> **non-binding**; final design is a separate, PM-approved step. (F2 crash-path release and F3 cleanup UX are
> noted as out of scope.)

## Summary

ForgeGate's workflow runner does not let a role agent write its own output. Instead, every role's structured
return is **serialized by the workflow and handed to the `forge-core-runner` subagent to write** to
`.forge/<role>-output.json` (`writeForgeFile`, `workflows/forge-run-ticket.workflow.js:215-230`). That single
mechanism is what the built-in auto-mode classifier denied for the scope-verifier verdict — it read "a generic
agent writing a scope-verifier APPROVE verdict the agent never actually performed" as content-integrity
stamping.

The persisted files are **load-bearing downstream**, not just an input to validation: the PM dispatch reads the
engineer/semantic/scope/facts files (`src/cli/run.ts:218-221`) and the run-report writer reads every role-output
file (`src/run-report/cli.ts:206-209, 227`). So a validation-only path (e.g. stdin) does not remove the need for
the artifacts to exist on disk.

The architecture already contains the **precedent for the fix**: `forge active-ticket … --out <path>` has Core
write the artifact **byte-exact via its own `fs`** (`src/cli/run.ts:277-281`) — landed in PR #48 to solve the
analogous Windows-corruption seam, where the problem was *also* "a subagent persisting bytes it was handed." The
role-output seam is the same shape one layer over: the safest directions move the *write* from the core-runner
subagent to Core itself.

## Source evidence

All line numbers are at `main @ 1b21783`.

- **The bridge writer** — `writeForgeFile(relName, obj)` (`workflows/forge-run-ticket.workflow.js:215-230`):
  serializes the object in the workflow, then dispatches the core-runner with *"Write the following exact JSON
  bytes to the file `<.forge/relName>`"*. Asserts exit 0. This is the only role-output persistence mechanism.
- **The validating consumer** — `persistAndValidateRole(role, fileName, roleObject, …)`
  (`workflows/forge-run-ticket.workflow.js:333-339`): calls `writeForgeFile` (the write), **then**
  `forge parse-agent <role> --json-file "<path>"` (the read+validate). The write and the validate are two
  separate core-runner commands; only the write was denied.
- **Core ingest surface** — `parse-agent` supports four input modes
  (`src/cli/run.ts:309-363`; `PARSE_AGENT_FLAGS`, `INPUT_MODES` at `:420-421`): `--file`, `--stdin` (YAML →
  `parseAgentOutput`) and `--json-file`, `--json-stdin` (JSON → `JSON.parse` → `ingestAgentOutput`).
  `ingestAgentOutput` (`src/agents/ingest.ts:37-50`) routes both `structured` and `yaml` sources through the
  **same** `validateRole` — Core Zod validation stays authoritative regardless of source. **`parse-agent` has no
  `--out`: it validates and echoes; it does not persist.**
- **The persist-via-Core precedent** — `active-ticket … --out` (`src/cli/run.ts:271-281`): Core resolves the path
  and `fs.writeFileSync`s the JSON itself (hook-free, no subagent). The workflow uses it at
  `workflows/forge-run-ticket.workflow.js:477-479`, and the inline comment there records it *replaced* an earlier
  `writeForgeFile` prose byte-write that corrupted Windows paths (the PR #48 fix).
- **Downstream file consumers (why the file is load-bearing):**
  - PM dispatch reads role/facts files: `src/cli/run.ts:218-221`
    (`fs.readFileSync(pmInputs.engineer|semantic|scope|facts)`).
  - run-report writer reads every role-output file: `src/run-report/cli.ts:206-209` (defaults) and `:227-229`
    (`io.readFileIfExists(inputs.engineer)` → `MISSING_INPUT` if absent).
- **Charter tool grants (frontmatter):**
  - `forge-core-runner` → `Bash, Read, Write` — **has Write.** The denial was therefore NOT a missing tool grant;
    the classifier blocked on *content/identity*, not capability.
  - `forge-engineer` → `Read, Edit, Write, Bash, Grep, Glob` (has Write).
  - `forge-semantic-verifier` → `Read, Grep, Glob, Bash` — **no Write (read-only by charter).**
  - `forge-scope-verifier` → `Read, Grep, Glob, Bash` — **no Write (read-only by charter).**
  - `forge-pm` → `Read, Grep, Glob` — **no Write, no Bash (judgment-only by charter).**
- **Provenance enum already exists** — the run-report trust-path enum carries `workflow_core_runner`
  (`src/run-report/cli.ts:32-35`), i.e. the model already names the core-runner as *a* persistence path; a
  redesign would add/serve a new provenance value.

## Current persistence model

| Artifact | Content produced by | Written by | Mechanism (file:line) | Feeds a gate? | Stamping-shaped? |
|---|---|---|---|---|---|
| `engineer-output.json` | engineer agent (typed `agent({schema})`) | **core-runner** | `writeForgeFile` via `persistAndValidateRole` (`workflow.js:537→334→215`) | parse-agent + PM input + run-report | change-set, not a verdict — **passed** |
| `semantic-verifier-output.json` | semantic agent (typed) | **core-runner** | `writeForgeFile` (`workflow.js:604`) | parse-agent + PM input + run-report | APPROVE verdict — **passed** |
| `scope-verifier-output.json` | scope agent (typed) | **core-runner** | `writeForgeFile` (`workflow.js:612`) | parse-agent + PM input + run-report | APPROVE verdict — **DENIED** |
| `pm-output.json` | PM agent (typed) | **core-runner** | `writeForgeFile` via `persistAndValidateRole` (`workflow.js` PM phase) | parse-agent + run-report | PASS/CORRECT verdict — **not reached** |
| `orchestrator-facts.json` | **workflow** (`buildFacts`) | core-runner | `writeForgeFile` (`workflow.js:699, 777`) | PM input + run-report | workflow facts, not an agent verdict |
| `active-ticket.json` | **Core** | **Core (`fs`)** | `active-ticket --out` (`workflow.js:478`; `run.ts:277-281`) | guard + run-report | Core-authored — never stamping |
| `decisions-ledger.json` | **Core** | **Core** | `ledger append` (`workflow.js:746`) | PM provenance + run-report | Core-authored |
| `run-report.json` | **Core** | **Core** | `run-report write` (`workflow.js:786`) | terminal artifact | Core-authored |

The split is stark: the three Core-authored artifacts (active-ticket, ledger, run-report) are never at risk; the
**four core-runner-written role/facts artifacts** are the exposed surface, and the **three that carry an agent
verdict** (semantic, scope, pm) are the stamping-shaped ones.

## Failure anatomy

1. The workflow held the scope-verifier's schema-valid `{verdict: "APPROVE", …}` object (the real typed return of
   the `forge-scope-verifier` agent, `workflow.js:599, 612`).
2. `writeForgeFile` dispatched the **core-runner** with *"Write these exact JSON bytes to
   `.forge/scope-verifier-output.json`"* (`workflow.js:215-225`).
3. The Claude Code **built-in auto-mode classifier** (present even in the hookless scratch-launched proof session)
   denied the write, reasoning the core-runner was *"writing a fabricated scope-verifier APPROVE verdict the agent
   never actually performed"* — i.e. **the writing agent (core-runner) is not the producing agent
   (scope-verifier)**: a generic utility stamping a verdict on another role's behalf.
4. `writeForgeFile` threw on the non-zero result (`workflow.js:226-228`); the unhandled throw terminated the run
   before PM and before the owner-checked release (that is F2).

**What the denial targeted (ranked by evidence):**
- **Writer identity ≠ producer identity** — *most-supported.* The denial text explicitly says the agent "never
  actually performed" the verdict; the core-runner is a generic bridge, not the scope-verifier.
- **Verdict/role semantics + APPROVE text** — *contributing.* The artifact is an authority-bearing APPROVE that a
  downstream gate acts on; the classifier names "scope-verifier APPROVE verdict" specifically.
- **Destination path** (`.forge/`) — *weak/unknown.* No evidence the path itself drove it.
- **Content shape** (JSON object) — *weak.* The engineer JSON object wrote fine moments earlier.

**Marked UNKNOWN (cannot be resolved from one run):** why the **semantic-verifier APPROVE write passed** at
`workflow.js:604` while the **scope-verifier APPROVE write was denied** at `:612`, despite near-identical
content shape and the same core-runner mechanism. This divergence is the single strongest signal that the
classifier is **probabilistic/content-sensitive, not a deterministic rule** — and therefore that "retry until it
passes" is not operability. A deterministic re-architecture is needed; the exact classifier trigger boundary
cannot be reverse-engineered from one observation.

## Prior successful writes vs failed write

| Write | Order in run | Content | Result | Note |
|---|---|---|---|---|
| `engineer-output.json` | 1st role persist | change-set summary (files, tests, commands) — **not a verdict** | **passed** | not authority-bearing |
| `semantic-verifier-output.json` | 2nd | `verdict: APPROVE` + acceptance evidence | **passed** | verdict-shaped, yet allowed |
| `scope-verifier-output.json` | 3rd | `verdict: APPROVE` + clean fence | **DENIED** | verdict-shaped, blocked |
| `pm-output.json` | — | PASS/CORRECT decision | **not reached** | run died at the scope write |

Inferable: (a) the seam is real and **content-sensitive** — the classifier discriminates on verdict semantics,
not just file writes; (b) it is **non-deterministic** across two near-identical APPROVE writes in the same run;
(c) the engineer (non-verdict) write is the least exposed, the three verdict writes the most. **Not** inferable
from one run: the precise trigger that separated semantic (allowed) from scope (denied); whether a second run
would deny semantic instead; whether PM would have been denied too. A reproducibility probe (below) is the only
way to characterize the boundary — but the fix should not depend on characterizing it, because a probabilistic
gate cannot be made operable by appeasement.

## Candidate directions (non-binding)

**A. Role-owned persistence** — each role writes its own verdict file (writer = producer, which directly answers
the classifier's objection).
*Tension:* the semantic-verifier, scope-verifier, and PM charters are **deliberately read-only** (`tools:` has no
`Write`; PM has no `Bash` either). Granting Write to read-only verifier/PM charters loosens a core safety
invariant (verifiers don't mutate; PM doesn't touch the repo) and would need charter edits + new exact-token
charter-lock tests. Trades a content-integrity concern for a capability-surface concern. **Plausible but
expensive and invariant-eroding; treat with caution.**

**B. Core-owned ingest from role-produced artifacts / stdin** — Core ingests the structured object and is the
sole writer. Two sub-shapes:
- B1 *validate-from-stdin only:* route the object through the existing `parse-agent --json-stdin`
  (`run.ts:344-362`) so no named verdict file is written by a subagent. **Insufficient alone** — PM dispatch
  (`run.ts:218-221`) and run-report (`run-report/cli.ts:227`) still require the files on disk.
- B2 *ingest-and-persist (new Core surface):* a Core command that validates the structured role object **and**
  writes the validated artifact to `.forge/<role>-output.json` via Core's own `fs` — exactly the
  `active-ticket --out` pattern (`run.ts:277-281`), the PR #48 precedent. The persisted file becomes
  **Core-authored**, not a subagent stamp. **Leading candidate.** Residual risk: the core-runner still conveys
  the verdict bytes into the Core command (e.g. `--json-stdin`), so the bytes still pass *through* a subagent
  command line/stdin — whether the classifier flags *that* is **UNKNOWN and must be probed** before committing.

**C. Workflow-owned neutral envelope + Core validation** — the workflow wraps the role return in a neutral
"captured agent output / provenance" envelope (this is the verbatim structured return of role X, captured by the
workflow), and Core validates+persists it. Reframes the artifact from "an APPROVE an agent stamped" to "a
captured, validated record written by Core." In practice this **collapses into B2** (Core must still be the
writer for the reframing to hold); the envelope is a presentation detail over the same Core-writes mechanism.

**D. Keep current model + permission carve-out** — add a settings rule allowing `.forge/**` artifact writes.
**Treat skeptically (PM-flagged), reject-leaning:** (1) it *hides* a real content-integrity signal — the
classifier is correctly noticing a generic agent stamping a verdict — rather than removing the stamping; (2) it
is environment-brittle: the proof failure happened in a **hookless scratch-launched session with no project
settings loaded**, so a project-`settings.json` carve-out would not even apply there (and the launcher path
*requires* that out-of-repo session); (3) it does not survive the non-determinism — a carve-out tuned to today's
classifier is not a guarantee. Records as considered-and-disfavored.

## Non-goals

Explicitly out of scope for this discovery and any contract it seeds:
- F2 crash-path lock release implementation (separate bounded fix; the orphaned lock from this run was already
  released owner-checked).
- F3 launcher cleanup EPERM → typed `CLEANUP_BLOCKED` UX.
- Stale-recovery UX (`forge lock` force/clear).
- Core execute-capture redesign.
- Worktree / shared-state location.
- Evidence / `run_id` artifact ownership.

(F2/F3 are listed only so the eventual contract can keep them in the same evidence packet; they are not solved
here.)

## Risks

- **Probing the classifier is itself probabilistic.** A spike that "passes once" does not prove a direction is
  safe; any chosen direction must remove the stamping *structurally* (Core as writer), not just observe a green
  run. The non-determinism (semantic passed, scope denied) is the proof of this.
- **B2's residual exposure** (verdict bytes still transit a core-runner command into Core stdin) is unproven —
  the contract must gate on a spike that confirms routing through a Core ingest-and-persist command is not itself
  denied, with a fallback (e.g. Core reads the object from a workflow-written *neutral* temp the core-runner
  produces with non-verdict framing, then Core persists the canonical artifact).
- **Direction A erodes the read-only verifier invariant** — the strongest non-negotiable in the charter set;
  any A-leaning design must justify why mutating that invariant is safer than moving the write into Core.
- **Downstream coupling** — PM dispatch and run-report read role files by path; any redesign must keep those
  files present and identically named (or re-plumb both consumers in the same change), or it breaks the gate
  chain.
- **Bootstrap/install** — `commands/forge-run-ticket.md` is installed; if a redesign touches it, the standard
  install-refresh + verify-install obligation applies (it would not if the change stays in `workflows/**` +
  `src/**`).

## Recommended contract shape

A **spike-gated, Core-owned ingest-and-persist** unit (direction **B2**, with **C** as its framing and **A**/**D**
recorded as rejected-leaning):

1. **Spike first (gitignored, throwaway, human-launched like this proof):** does routing a verifier APPROVE
   through a *Core-owned* validate-and-persist path (Core does the `fs` write, as `active-ticket --out` does)
   avoid the auto-mode-classifier denial — including when the core-runner conveys the bytes into the Core command?
   Output: a finding that picks the exact mechanism (stdin vs neutral-temp handoff) and confirms the write is
   Core-authored end-to-end. **No design is committed until the spike answers the residual-exposure UNKNOWN.**
2. **Then a Core surface** that validates a structured role object and persists the validated
   `.forge/<role>-output.json` itself (new `parse-agent … --out`, or a sibling `ingest --out`), mirroring
   `active-ticket --out`; the workflow's `writeForgeFile` for the three **verdict** roles (and optionally all
   four) is replaced by that Core call, so no subagent ever writes a verdict file.
3. **Provisional allowed_paths (to confirm at contract time):** `src/cli/run.ts` (+ test), the Core ingest/
   parse-agent module (+ test), `src/run-report/**` only if a new provenance value is added,
   `workflows/forge-run-ticket.workflow.js`, the workflow protocol test, and the epic docs. **Forbidden:** the
   read-only verifier/PM charters (`agents/**`) unless the spike forces direction A — which would be a re-scope,
   not a silent expansion; `.claude/**` (no hook/settings carve-out — direction D is rejected); the lock/guard/
   schema primitives.
4. **Carry F2 + F3** into the same epic as separate small tickets so the crash-path release and the launcher UX
   land under one evidence packet (the finding already links them), but sequence the F1 persistence fix first —
   it is the one blocking full workflow operability.

This keeps the fix on the established ForgeGate spine: **Core owns the write** (the #45 `repo snapshot` / #48
`active-ticket --out` lineage), the read-only verifier invariant is preserved, and no permission carve-out is
introduced to mask a real integrity signal — but it commits to nothing until a spike resolves whether
Core-authored persistence actually clears the classifier.
