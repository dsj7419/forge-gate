# Capture-Protocol Hardening — Discovery

> Discovery only. Author: senior engineer, 2026-05-30. Status: **for PM review — no implementation, no epic,
> no branch, no commit.** Mission (PM-set): move the one-action-per-step agent-output capture rule from a
> memory/process expectation into the actual ForgeGate run protocol, command docs, and/or tests so future runs
> cannot silently drift back into pre-writing, summarizing, or reconstructing agent-output files.
>
> First bar (PM): identify exactly where the current run protocol allows synthesized/captured-output ambiguity,
> then propose the **smallest** contract to make agent-output capture one-action-per-step and auditable.
> Evidence cited inline by `path:line`. Anything I could not fully prove from code is labelled **(hypothesis)**.

---

## Why this is the next unit (context)

The B1 arc (`forge-gate-provenance`, shipped PR #14) twice surfaced the same process failure: the orchestrator
**composed agent-output YAML and wrote it to the capture path** instead of transcribing the dispatched agent's
real return — once as outright fabrication (the tainted first run, reset), once as milder "pre-write in a
batched turn, then correct" (the fresh run). Both were caught and disclosed before any commit; the final
artifacts were the real returns. The rule now lives in memory
([[b1-fabricated-agent-output-incident]]) but **only as a discipline expectation** — nothing in the protocol or
Core structurally channels capture into one auditable action. Before ForgeGate runs larger, more autonomous
workflow-era tasks, this seam should be closed. PM classification: **SHOULD_FIX_BEFORE_MORE_COMPLEX_RUNS,
high priority, before the workflow-runner work.**

---

## The capture seam, precisely

**Where capture happens today (the Markdown orchestrator path):** `commands/forge-run-ticket.md` instructs the
orchestrator, at each agent step, to *"Capture the agent's raw output to `$EPIC/.forge/<role>-output.yaml` …
then run `$FORGE parse-agent <role> --file …`"* (steps 5 engineer, 8 verifiers, 9(e) PM). The capture is a
**free-form file write performed by the orchestrator LLM**, whose faithful behavior is the only thing binding
the captured file to the agent's actual Task-tool return.

**The trust model, stated honestly (the attest-vs-prevent doctrine applies here too):**

- **Core attests schema validity, not capture fidelity.** `parse-agent` → `parseAgentOutput`/`validateRole`
  (`src/agents/parse-output.ts:38-77`) validates *whatever bytes are in the file* against the role schema. It
  is never-repair and strict, but it **cannot distinguish a verbatim agent return from orchestrator-composed
  text** — both can be schema-valid. Core validates *content vs schema*, never *content vs the real return*.
- **Core is a CLI; it cannot observe the Task-tool return.** Exactly like Core cannot *prevent* a `git commit`
  (only refuse to attest one), Core cannot *prevent* a composed capture — it never sees what the agent
  actually returned. So capture fidelity, like the human gate, is **"durable if adapted"**: prevention must
  live in the substrate (the protocol the orchestrator follows + whatever deterministic affordance replaces
  the free-form write), and Core's job is to make the sanctioned path the only one and make drift auditable.

**Concrete ambiguity findings:**

| # | Finding | Evidence |
|---|---|---|
| F1 | **Capture is free-form prose.** "Capture the agent's raw output to `<path>`" does not say *one action, verbatim, no compose/summarize/reconstruct, not batched with the dispatch*. An orchestrator can read it as license to write composed YAML, and can batch dispatch+capture+validate in one turn (the exact B1 failure). | `commands/forge-run-ticket.md` steps 5, 8, 9(e) |
| F2 | **`parse-agent` validates content-vs-schema, not content-vs-return.** No provenance binding between "the agent that was dispatched" and "the file that was validated." | `src/agents/parse-output.ts:38-77`; `src/cli/run.ts:239-323` |
| F3 | **No record of capture method.** Neither `.forge/` nor the run-report records whether each output was captured raw or reconstructed, so even post-hoc an auditor cannot tell. (`agent_output_source` is the related Phase-1c field, not yet shipped, and as designed it records structured-vs-yaml, not raw-vs-composed.) | `src/run-report/schema.ts` (no capture-method field); [[workflow-era-pivot]] Phase 1c |
| F4 | **Dispatch and capture are unbound files.** `forge dispatch <role>` emits the prompt spec to one file; the captured return lands in a separate orchestrator-written file with no link asserting they belong to the same dispatch. | `commands/forge-run-ticket.md` steps 5/8/9; `src/cli/run.ts` dispatch vs parse-agent |
| F5 | **Workflow path is structurally safer but undefined here.** Under the future workflow runner the script holds the `agent({schema})` return in a variable and a `core-runner` writes it — capture is naturally one-action (the script can't "compose" a richer object than it received). But that path isn't built, and the *Markdown fallback* — which stays maintained (audit RETIRE-eventually) — remains prose-dependent. | [[workflow-backed-runner-phase2-design]] §Structured-Output Agent Path |

**Net:** the seam is **F1 + F2** — free-form capture prose, plus a validator that can't see provenance. The
smallest effective fix tightens the *sanctioned capture action* and makes its discipline *locked by a test*,
optionally adding a deterministic Core capture affordance that removes the "orchestrator hand-writes the file"
degree of freedom.

---

## What "one-action-per-step + auditable" must mean

From the PM's standing rule, the sanctioned capture sequence per agent step is exactly:

```
1. forge dispatch <role> …        (Core emits the prompt spec)
2. Task(subagent_type, prompt)     (dispatch; WAIT for the return)
3. capture the EXACT returned text verbatim → .forge/<role>-output.yaml   (its own isolated action)
4. forge parse-agent <role> --file …                                       (Core validates that file)
5. continue
```

Forbidden, explicitly: pre-writing the capture file before/with the dispatch; summarizing or reconstructing the
return; batching steps 2–4 into one turn; validating synthesized output. "Auditable" means: a reviewer (or a
later automated check) can tell that step 3 produced the agent's real bytes, not composed text.

---

## Options for the smallest contract (evaluate; recommend; do NOT implement)

### Option A — Protocol rewrite + lock test (docs + test only) — RECOMMENDED core
Make the discipline explicit and **machine-locked**, mirroring the existing charter-format precedent.

- **A1 — Rewrite the capture steps in `commands/forge-run-ticket.md`** (steps 5, 8, 9(e)) to state the exact
  one-action-per-step sequence above and a hard "never compose / summarize / reconstruct / pre-write / batch
  capture with dispatch; if the return is malformed, write it verbatim anyway and let `parse-agent` fail" rule.
  Add a short top-level **Capture discipline** subsection so it's stated once, authoritatively.
- **A2 — Add a protocol-lock test** that reads `commands/forge-run-ticket.md` and asserts the capture-discipline
  language is present (the required phrases / the explicit sequence). **Precedent exists and is proven:**
  `src/agents/charter-output-format.test.ts` already reads the charter `.md` files and asserts required wording;
  this is the same pattern applied to the command. This is what converts "memory rule" into "tree-blocking
  invariant" — if a future edit drops the discipline language, the suite goes red.
- **Pros:** smallest footprint; no Core code change; directly addresses F1; the lock test addresses "cannot
  silently drift" literally. Strengthens the Markdown fallback (the only prose-dependent path).
- **Cons:** does not add a *structural* barrier to a non-compliant orchestrator (it tightens and locks the
  instruction, and makes violations a disclosed/auditable departure, but Core still can't see the Task return —
  consistent with attest-not-prevent). Touches `commands/**`, which shifts the install-currency surface (see
  Risks).

### Option B — Deterministic Core capture affordance (`forge capture-agent`) — STRONGER, optional add-on
Replace the orchestrator's free-form Write with a Core command: `forge capture-agent <role> <epic> --stdin`
reads the agent return from stdin and writes it **byte-for-byte** to the canonical `.forge/<role>-output.yaml`,
then (optionally) runs the same validation. The orchestrator pipes the Task return straight into Core.

- **Pros:** removes the "orchestrator hand-authors the capture file" degree of freedom — capture becomes a
  single deterministic Core op with a fixed canonical path (no path typos, no partial writes); composes
  cleanly with the future workflow `core-runner` (same command). Narrows F1/F4 structurally.
- **Cons:** Core *still* cannot verify the piped bytes are the real return (the orchestrator could pipe composed
  text) — so it is a **narrowing, not a prevention**; adds a new CLI surface for a v1 that has resisted growth;
  larger than A. **Recommendation: design now, defer build** — fold into the workflow-runner work where the
  `core-runner` already needs a write-to-`.forge/` capability, rather than as a standalone v1 CLI surface.

### Option C — Capture-method auditability in the run-report — DEFER to Phase 1c
Record per role how the output was captured. This overlaps the already-designed Phase-1c `agent_output_source`
(`structured` | `yaml`), which is about *delivery surface*, not *raw-vs-composed*. Adding a raw-vs-composed
signal would touch the **frozen `forge-run-report/v1` schema** (`src/run-report/schema.ts` — forbidden-by-default,
its own sensitive ticket). **Recommendation: do NOT bundle here**; revisit with Phase 1c. Note that auditability
is also partly served by A2 (the lock test) + the disclosed-departure discipline.

---

## Recommendation

**Option A as the unit (A1 rewrite + A2 lock test), Option B designed-but-deferred, Option C deferred to 1c.**

Rationale: the seam is F1 (free-form capture prose) amplified by F2 (no provenance in the validator). The
smallest contract that makes capture *one-action-per-step and auditable* is to (1) write the exact sequence and
the never-compose rule into the authoritative protocol, and (2) **lock it with a test** so it cannot silently
drift — which is precisely the PM's stated goal and has a proven in-repo precedent
(`charter-output-format.test.ts`). Option B is the stronger structural move but is larger and belongs with the
workflow `core-runner`; flagging it as the future hardening rather than v1 scope keeps this unit minimal and
substrate-independent. This unit strengthens the Markdown fallback today and sets the discipline both runners
inherit.

---

## Proposed ticket shape (for the contract step — NOT authored yet)

- **Epic (likely):** `forge-capture-protocol-hardening`, one sprint, one ticket `T01`.
- **kind:** `green` (RED lock-test first, then the protocol edit makes it pass — though the artifact under test
  is a `.md`, so framing is "add the lock test that fails against today's wording, then update the wording").
- **risk:** `low` · **change_class:** `docs` (avoids the negation-blind escalation keywords; the work is
  protocol/docs + a test, no Core logic) · **blast_radius:** `local`.
- **gate:** `pr`. Confirm `gate: pr, no escalation` via `forge run --dry-run` at contract time — and watch the
  wording: the capture-discipline prose will contain words like "reconstruct"/"never" but **must avoid** the
  escalation keywords (`delete`, `remove`, `secret`, `.env`, `prod`, `migration`, `auth`) in title/body/paths.
- **allowed_paths (proposed):**
  - `commands/forge-run-ticket.md` (the protocol rewrite — A1)
  - a new lock test, e.g. `src/agents/charter-output-format.test.ts` is for charters; the command lock test
    needs a home — propose `src/commands/run-ticket-protocol.test.ts` (**new dir** `src/commands/`) **or**
    co-locate as `src/install/run-ticket-protocol.test.ts`. (Open question — see below.)
  - optionally `docs/forge-run-ticket-design.md` and/or `README.md` if the capture wording is mirrored there
    (verify at contract time; include only if they actually carry capture prose).
- **forbidden_paths (proposed):** `src/run-report/**` (frozen schema, Phase-1c territory), `src/agents/**`
  (parser/charters unchanged), `src/orchestrator/**`, `src/cli/run.ts` (no new CLI surface in Option A),
  `src/schema/**`, `agents/**`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `vitest.config.ts`,
  `docs/epics/**`.
- **Self-run note:** this ticket edits `commands/forge-run-ticket.md` — **the very procedure the orchestrator
  executes.** Running it via `/forge-run-ticket` means the run is governed by the *old* command text while it
  edits the command (a bootstrap, like the dist-freeze lessons). Capture discipline for *this* run leans on the
  freshly-tightened memory rule, not the file being edited. Flag as a documented bootstrap in the run-report
  `--note`. (hypothesis: acceptable, same shape as prior self-runs that shipped their own mechanism.)

---

## Risks / call-outs

- **Install-currency surface.** `commands/forge-run-ticket.md` is a Core-required installed file
  (`src/install/manifest.ts` enumerates the commands/agents `verify-install` checks). Editing it means after
  merge the installed copy is **stale** until `pnpm install-commands` is re-run — expect `verify-install` to
  report stale post-merge; refresh is a deliberate, PM-approved step (the standing pre-run rule).
- **`commands/**` is normally forbidden.** Every prior ticket forbade `commands/**`; this is the first ticket
  whose scope *is* the command. The contract must consciously move `commands/forge-run-ticket.md` into
  `allowed_paths` — flag it loudly so the scope-verifier reads it as intended, not as creep.
- **Lock test brittleness.** A wording-assertion test must check for the *load-bearing discipline phrases*, not
  the entire paragraph, or trivial copy edits will break it. Model the tolerance on
  `charter-output-format.test.ts` (representative-phrase sweep, not exact-string match).
- **Honest scope of the fix.** This narrows and locks the *instruction* and makes drift auditable/red-on-CI; it
  does not make a non-compliant orchestrator *impossible* (Option B narrows further; true prevention only
  arrives with the workflow runner's deterministic capture). The doc should state this plainly rather than
  overclaim — consistent with the README's anti-overclaiming voice.

---

## Open questions for Dan

1. **Scope: A only, or A + design-stub for B?** My lean: ship A (rewrite + lock test) as the unit; capture B
   (`forge capture-agent` / `core-runner` write) as a *design note* folded into the workflow-runner work, not a
   v1 CLI surface now. OK?
2. **Lock-test home.** New `src/commands/` dir + `run-ticket-protocol.test.ts`, or co-locate under an existing
   dir (e.g. `src/install/`)? My lean: a small new `src/commands/` test dir reads cleanest and mirrors the
   `src/agents/` charter-test precedent. (Adds a directory — minor.)
3. **Mirror wording in `docs/forge-run-ticket-design.md` / `README.md`?** Only if they already carry capture
   prose worth keeping in sync. I'll confirm exact occurrences at contract time and include those paths only if
   real. OK to let the contract step finalize that list?
4. **change_class `docs` vs `refactor`.** It's docs + a test, no runtime code. `docs` keeps it lowest-risk and
   non-escalating; confirm that's the right class (a test-only addition sometimes reads as `test`). My lean:
   `docs` (primary artifact is the protocol) — but `test` is defensible. Your call at contract time.
5. **Defer confirmation.** This stays discovery-only. On your go I author the contract (epic + T01), validate +
   dry-run, and report before any run — same cadence as B1, now under the tightened capture rule.
