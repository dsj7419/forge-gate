# Spike Plan — Core-owned role-output ingest and persist

> **Status: plan only — no execution, no source edits, no contract.** Designs a bounded, throwaway, human-launched
> spike to answer the F1 residual-exposure question before any implementation contract. References:
> finding `docs/workflow-launch-operability-finding.md`; discovery `docs/workflow-role-output-persistence-discovery.md`.
> Proof context that motivated it: `run_id bef9af6c-d14a-4701-9cee-e286ace00730`, workflow run
> `wf_0c098781-275`, classification `PARTIAL_OPERABILITY_CONFIRMED_WITH_BLOCKERS`. The spike, when approved, runs
> as a separate human-launched step — **this plan does not execute it.**

## Purpose

Answer **one** question with evidence:

> Does a **Core-owned ingest-and-persist** path clear the Claude Code auto-mode classifier in the **same
> hookless, scratch-launched substrate** where the scope-verifier persist failed?

And, inseparably, the **residual byte-transit sub-question** the discovery flagged as the leading UNKNOWN:

> Even if Core performs the filesystem write, does passing **verifier-shaped APPROVE verdict bytes through a
> core-runner command** (into Core via stdin / a handoff) still trigger classifier denial?

The discovery (`docs/workflow-role-output-persistence-discovery.md`) established that today's failure is the
core-runner being asked to *write* a verdict it did not produce (`writeForgeFile`,
`workflows/forge-run-ticket.workflow.js:215-230`), that the persisted files are load-bearing downstream
(PM dispatch `src/cli/run.ts:218-221`; run-report `src/run-report/cli.ts:227`), and that the architecture already
owns the candidate fix shape (`active-ticket --out`, Core writes via its own `fs`, `src/cli/run.ts:277-281`). The
spike tests whether that shape actually clears the classifier — it does **not** assume it.

## Non-goals

- Not solving F2 (crash-path owner-release) or F3 (launcher cleanup EPERM UX) — those are separate tickets in the
  same epic.
- Not editing the real workflow, Core, charters, or tests (the spike harness is throwaway/gitignored).
- Not contracting the F1 implementation — the spike's output is a finding that *informs* the contract.
- Not re-proving scratch placement / the launch-cwd gate / launcher lifecycle (already proven, PR #57 + the
  operability run).
- Not characterizing the classifier's full rule set — only the pass/deny behavior of the specific transport
  variants below, as a *rate*.

## Substrate requirement

The denial occurred in a **fresh Claude session launched from a Forge-owned OS-temp scratch cwd, with no
ForgeGate permissions hook and no project `settings.json` loaded** (the launcher path requires that out-of-repo
session). The classifier under test is Claude Code's **built-in auto-mode classifier**, which is present there
regardless of ForgeGate's hook. Therefore:

- The live substrate test **must** run in a fresh Claude session launched from an OS-temp scratch cwd via
  `scripts/launch-workflow.mjs prepare` (the proven launcher), exactly like the operability confirmation run.
- A repo-launched session (like the orchestrator session that prepares the spike) **cannot** substitute — it has
  a different hook/settings posture and would not reproduce the denial environment.
- The spike must reach the same dispatch shape that failed: a `forge-core-runner` subagent handling
  verifier-shaped APPROVE bytes. A pure CLI invocation from the repo session proves nothing about the classifier.

## Hypotheses

- **H1** — *Core-owned `fs` write clears the classifier when verdict bytes are passed through stdin or a neutral
  handoff.* (The `active-ticket --out` shape generalizes: if Core is the writer, the classifier permits it.)
- **H2** — *Passing verifier-shaped APPROVE bytes through a core-runner command still triggers denial even if Core
  is the final writer.* (The residual byte-transit exposure: the bytes in the command/stdin are what the
  classifier reacts to, not the `fs.writeFileSync` call.)
- **H3** — *Content shape matters more than writer identity.* (An APPROVE verdict is denied wherever it travels;
  reframing/neutral-enveloping it changes the outcome.)
- **H4** — *Writer identity matters more than content shape.* (Who performs the write is decisive; Core-as-writer
  clears it regardless of verdict content.)
- **H5** — *The failure is probabilistic enough that one pass is insufficient evidence.* (Confirmed-leaning
  already: in the proof run the semantic APPROVE write passed and the near-identical scope APPROVE write was
  denied in the *same run* — so a single green is not a verdict; pass/deny must be measured as a rate.)

H3 and H4 are deliberately opposed — the variant matrix is designed so their results discriminate between them.

## Spike design

A throwaway harness (gitignored, e.g. under `.forge/spikes/role-output-persist/`) that, **inside the
scratch-launched session**, dispatches a `forge-core-runner` subagent per variant against a fixed,
verifier-shaped APPROVE payload and records the outcome. The harness:

- Uses a **fixed canonical payload**: a real-shaped scope-verifier APPROVE object
  (`{verdict: "APPROVE", changed_files: […], allowed_path_status: "clean", forbidden_path_violations: [], …}`) —
  the exact content class that was denied — held constant across all variants so the only thing varying is the
  **transport**.
- Targets a **gitignored throwaway destination** (e.g. `.forge/spikes/role-output-persist/out/<variant>-<n>.json`),
  never a tracked path and never the real `.forge/<role>-output.json`.
- For the Core-write variants, exercises a **throwaway Core entrypoint** (a spike-local `.mjs` that calls the real
  `ingestAgentOutput` / `validateRole` and does its own `fs.writeFileSync`) so the production CLI is **not**
  edited — the spike proves the *mechanism shape*, not a shipped surface. (`parse-agent` has no `--out` today;
  the spike models what one would do, without adding it to `src/cli/run.ts`.)
- Records, per attempt, the full evidence row (below) including any classifier denial text verbatim.

The orchestrator (repo-launched) session may author this harness and the `prepare` step; it must **not** run the
live dispatch.

## Test matrix

Four transport variants × the fixed APPROVE payload. **D is the known-risk baseline (the current mechanism), not
a preferred design.**

| Variant | Transport | Writer (final `fs`) | Producer of bytes | Models |
|---|---|---|---|---|
| **A** | core-runner pipes verifier-shaped JSON to a Core ingest-and-persist command via **stdin** | Core (`fs`) | core-runner conveys | B2 stdin shape — tests H1 vs H2 |
| **B** | core-runner writes a **neutral envelope** (non-verdict framing: "captured structured output of role X, runId, schema") to a temp, then Core validates+persists the canonical artifact from it | Core (`fs`) | core-runner conveys neutral wrapper | C / neutral-handoff — tests H3 (does reframing clear it?) |
| **C** | the **verifier/role agent writes its own artifact** directly (writer = producer) | role agent | role agent | direction A — tests H4 (does writer=producer clear it?) |
| **D** | current `writeForgeFile` — core-runner writes verifier-shaped APPROVE bytes directly | core-runner | core-runner conveys | baseline; reproduces the known denial |

Notes:
- Variant **C** requires a Write-capable agent; the spike uses a **throwaway generic agent with Write**, NOT an
  edit to the real read-only verifier charters (which is the whole tension direction A carries). It tests the
  *classifier behavior* of writer=producer, not whether we would grant verifiers Write.
- Variant **D** must be included to confirm the substrate still reproduces the denial *this* session (a clean D
  would mean the environment changed and the whole matrix is uninterpretable until re-grounded).

## Repetition strategy

The denial is content-sensitive and **probabilistic** (H5, already evidenced). One attempt is never a verdict.

- **N = 5 attempts per variant** (minimum; 20 dispatches total). The plan-approver may raise N.
- Per variant, classify on the pass/deny **rate**:
  - **confirmed (clears):** **5/5 attempts written successfully**, no classifier denial on any attempt.
  - **rejected (blocked):** **≥1/5 attempts denied** by the classifier (any denial means the path is not
    reliably operable — a probabilistic gate is not cleared by a partial pass).
  - **inconclusive:** non-classifier failures (tool error, harness bug, environment drift) prevent a clean
    pass/deny read on ≥1 attempt, OR variant D did **not** reproduce the baseline denial (environment not
    grounded). Re-ground and re-run before interpreting.
- Token/time budget: each dispatch is small (one payload, one write); 20 dispatches is far cheaper than a full
  workflow run. If the launcher session must also run a real workflow to reach the dispatch, scope that
  explicitly at approval — the preferred design is a **minimal harness that dispatches the core-runner directly**,
  not a full ticket loop.

## Evidence to collect

One row per attempt, written to the gitignored spike evidence file
(`.forge/spikes/role-output-persist/evidence.json`):

- variant (A/B/C/D)
- attempt number (1..N)
- writer identity (which agent/Core performed the final `fs` write)
- producer identity (which agent produced the bytes)
- destination path
- content shape (verifier-shaped APPROVE | neutral envelope)
- exit status
- classifier denial text **verbatim** if any (else null)
- whether the file was written (bool)
- whether `parse-agent` (real Core) can ingest the written file (bool + code)
- whether a downstream PM/run-report-equivalent could consume it (bool — modeled, not the real gate chain)
- scratch cwd
- session_id
- run_id (the launcher-minted id for the spike session)
- timestamp (recorded by the harness at write time)

Plus a per-variant summary (pass count / N, classification) and the overall finding.

## Decision gates

- **B2 / Core-owned persistence succeeds reliably** (A confirmed: 5/5, no denial) →
  **contract F1 around Core-owned ingest-and-persist** for the **four agent outputs** (engineer,
  semantic-verifier, scope-verifier, PM), per the accepted rewrite scope.
- **Stdin/byte-transit fails but neutral handoff succeeds** (A rejected, B confirmed) →
  **contract around the neutral-handoff + Core validate/persist** shape.
- **Role-owned writes are the only reliable path** (A and B rejected, C confirmed) →
  **escalate to Sr PM** — it conflicts with the deliberately read-only verifier/PM charter posture; the decision
  to grant Write to verifier/PM charters is the Sr PM's, not the engineer's.
- **All variants unreliable** (A, B, C all rejected/inconclusive) →
  **do not contract implementation;** open deeper substrate / Claude Code permissions discovery (e.g. is there a
  supported provenance/attestation mechanism the classifier honors?).
- **Permission carve-out (direction D-fix) remains rejected-leaning** unless **every** safer path fails — and even
  then it returns to the Sr PM as an explicit, justified exception, never a default, because it would not apply in
  the hookless scratch substrate anyway (discovery §"why a permission carve-out is rejected-leaning").

## Safety boundaries

The spike is **throwaway and gitignored**. It must NOT:

- modify tracked source (workflow, Core, charters, tests);
- modify production workflow behavior;
- write into any non-gitignored / tracked location;
- commit, push, open a PR, or merge;
- status-write-back or journal-write;
- force-break, clear, or steal any lock (if the spike acquires a lock it releases it owner-checked; a crash leaves
  it for human-approved release, per F2 discipline);
- delete unrelated files (cleanup removes only the spike's own gitignored scratch/output).

All spike artifacts live under gitignored `.forge/` paths. The throwaway Core entrypoint is a spike-local `.mjs`,
never an edit to `src/cli/run.ts` or any shipped module.

## Cleanup

- After evidence capture: remove the gitignored spike harness + output (`.forge/spikes/role-output-persist/`),
  keeping only the evidence summary referenced by the resulting finding (or fold the summary into the finding
  doc).
- The launcher scratch cwd is cleaned via `scripts/launch-workflow.mjs cleanup` (ownership-verified) **after the
  scratch-launched session is closed** (F3: close the session first to avoid the EPERM).
- Any lock the spike acquired is released owner-checked; the disposable clone (if used) is left for the next
  refresh as usual.
- Session repo and clone must end with `git status` clean (no tracked changes from the spike).

## How results feed the contract

The spike produces a **finding doc** (root-level, e.g. `docs/workflow-role-output-persistence-spike-finding.md`)
recording the variant pass-rates, the chosen direction per the decision gates, and the residual-exposure answer.
That finding then seeds **one epic with three tickets, F1 first** (the accepted packaging):

- **T01 — F1 role-output persistence seam** (the design the spike selected; covers the **four agent outputs**, not
  orchestrator-facts).
- **T02 — F2 crash-path owner-release on unhandled workflow failure.**
- **T03 — F3 launcher cleanup EPERM typed `CLEANUP_BLOCKED` UX.**

No implementation is contracted until the spike's decision gate is met; if the gate lands on "all unreliable" or
"role-owned only," the next step is Sr PM escalation / deeper discovery, not a contract.
