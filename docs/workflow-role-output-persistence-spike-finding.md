# Finding — F1 role-output persistence B2 spike

> **Classification: `B2_SPIKE_INCONCLUSIVE_BASELINE_NOT_GROUNDED`.** The bounded B2 spike specified in
> `docs/workflow-role-output-persistence-spike-plan.md` (PR #60) ran and **halted INCONCLUSIVE after its grounding
> baseline (Variant D) failed to reproduce the known F1 classifier denial.** It neither validates nor refutes B2;
> it proves the isolated, synthetic harness is not faithful enough to reproduce this denial class. This records the
> finding; it is not a contract. Chain: finding `docs/workflow-launch-operability-finding.md` (#58) → discovery
> `docs/workflow-role-output-persistence-discovery.md` (#59) → spike plan (#60) → this. Machine evidence is
> preserved (gitignored) at the launcher-evidence path below.

## Context

| Item | Value |
|---|---|
| Baseline | `main @ fd9d8e0` |
| `run_id` | `6c3bbc49-657e-44a1-b780-182a286b1a58` |
| `session_id` | `074ea651-8060-445e-9d08-a588c6b8a446` |
| Scratch cwd | `C:/Users/dsj74/AppData/Local/Temp/forge-launch-6c3bbc49-657e-44a1-b780-182a286b1a58` (removed at cleanup) |
| Target repo | `D:/Projects/forge-workflow-live-proof` (disposable clone, clean @ `fd9d8e0`) |
| Spike location | `D:/Projects/forge-workflow-live-proof/.forge/spikes/role-output-persist/` (disposable; removed at cleanup) |
| Launcher evidence (preserved) | `D:/Projects/forge-workflow-live-proof/.forge/launch-evidence/6c3bbc49-657e-44a1-b780-182a286b1a58.json` |

Design (per the plan, all accepted): fresh OS-temp-launched session; minimal **direct core-runner dispatch**
harness (not a full workflow loop); fixed **synthetic** verifier-shaped scope-verifier APPROVE payload;
**N = 5** per variant; order **D → A → B → C**. Variants: **D** current `writeForgeFile` baseline (core-runner
Write); **A** Core-owned persist via stdin (Core/Node `fs` write; bytes transit the core-runner command);
**B** neutral envelope → Core unwrap+validate+persist; **C** writer = producer (throwaway generic Write agent,
NOT a real verifier charter).

## Facts

- **Variant D ran first.**
- **Variant D produced 0/5 classifier denials** (denial rate 0/5; the auto-mode classifier gated nothing on the
  baseline).
- **A/B/C were correctly not run** — the stop rule fired: *"if D produces NO classifier denial across its 5
  attempts → STOP, classify INCONCLUSIVE (substrate not grounded)."*
- **All five D artifacts were written and ingestable through real Core** — each `out/D-<n>.json` validated via
  `node dist/cli.js parse-agent scope-verifier --json-file …` → `ok: true`, exit 0. (Minor, immaterial fidelity
  notes recorded in the evidence: D-3 omitted a trailing newline yet still parsed clean; D-5 was written via a
  bash heredoc rather than the Write tool — same writer identity and transport class.)
- **The spike followed its own stop rule** and halted before A/B/C.
- **The result does not validate B2.**
- **The result does not refute B2.**
- **The result proves the isolated synthetic harness was not faithful enough to reproduce this denial class.**
- **Bonus (placement):** the launcher post-scan was clean across all three locations (session repo, target repo,
  launch cwd) — confirming the launch-cwd scratch prevention holds for an agent-**dispatch** session, not only a
  full workflow run.

## Reasoning — why the baseline could not be grounded

The original F1 denial (operability run `wf_0c098781-275`) occurred when the core-runner was asked to persist a
**real** scope-verifier APPROVE verdict that a **real** scope-verifier agent had just produced and that **real**
downstream gates (PM dispatch, run-report) were about to act on. The classifier's stated basis was: *"writing a
fabricated scope-verifier APPROVE verdict the agent never actually performed … a content-integrity/verification-
stamping violation that downstream gates will act on."*

The spike payload was, by design, **synthetic and self-labeled** ("SYNTHETIC F1 CLASSIFIER SPIKE PAYLOAD — not a
real verdict for any real ticket; epic spike-synthetic does not exist") and ran in **isolation** (no workflow, no
real verifier, no real downstream gate). Those two safety constraints were correct — they avoid inventing a real
approval — **but they remove the exact conditions the classifier objected to:** a fabricated *real* verdict that a
*real* gate will act on. The payload explicitly negates both halves of the classifier's stated concern, so the
classifier had nothing to flag. The instrument is **structurally mismatched** to the denial.

Two consequences:

- **Do not try to force reproduction by fabricating a real approval.** Making the spike reproduce the denial would
  require making the payload look like a real fabricated verdict for a real gate — the very thing we refuse to
  fabricate. The constraint and the trigger are in direct conflict.
- **Do not pursue a permission carve-out.** (Unchanged from the discovery: it hides a real integrity signal and
  would not apply in the hookless scratch substrate anyway.)
- **B2 remains possible but cannot be contracted from this spike.** Only an **in-context workflow proof** — the
  candidate Core-owned-persist wired into a real workflow run, observing whether the denial recurs — can answer B2
  cleanly.

The spike did, however, **narrow** the problem positively: the denial is **not** a deterministic rule that "the
core-runner can never write a verdict." Five synthetic verdict writes were permitted here, and in the original run
the **semantic** verifier APPROVE write *passed* while the near-identical **scope** verifier APPROVE write was
*denied in the same run*. The denial is **occasional, probabilistic, and context-sensitive** — which is the
load-bearing input to the strategic decision below.

## Accepted strategic decision

**Re-sequence F2 before F1 implementation.**

Rationale: because the F1 denial is real but rare / context-sensitive and could not be safely reproduced in
isolation, the workflow should first **survive substrate failures cleanly**. **F2 — crash-path owner-release — is
now the higher-value next implementation target:** an unhandled persistence failure (such as this classifier
denial) should become a **typed terminal escalate with an owner-checked lock release**, not an orphaned lock and a
dead run (which is what the operability run produced). This is not "retry until green" — it is graceful terminal
handling of a substrate the workflow cannot make deterministic.

## F1 status

- **F1 remains open and architectural.**
- **B2 remains a candidate** (the Core-owned ingest-and-persist direction is not eliminated).
- **No F1 implementation contract should be authored from this spike alone** — only an in-context workflow proof
  can answer B2.

## F2 / F3 carry-forward

- **F2 — crash-path owner-release** should be promoted to the next implementation unit (T02 in the planned epic,
  now sequenced ahead of F1's T01).
- **F3 — launcher cleanup EPERM typed UX** remains a small follow-up (re-confirmed live this spike: launcher
  cleanup EPERMs while the scratch-launched session is still open; close the session first → cleanup succeeds
  ownership-verified). It should emit a typed `CLEANUP_BLOCKED` with a close-session hint rather than a raw stack.

## Sequencing after this doc

finding (this doc) → **F2-first contract** (crash-path owner-release on unhandled workflow failure), with F1
preserved as architectural and unresolved rather than treated as answered. F1's eventual B2 validation is an
in-context workflow proof, authored as its own unit when promoted. The launcher evidence
(`…/.forge/launch-evidence/6c3bbc49….json`) may be retired once this finding lands.
