---
schema_version: 1
id: T01
title: Wire the workflow-backed runner to forge lock for cross-run serialization
kind: green
risk: high
change_class: feature
blast_radius: app
status: pending
depends_on: []
blocks: []
allowed_paths:
  - workflows/forge-run-ticket.workflow.js
  - src/workflows/forge-run-ticket-workflow-lock.test.ts
  - docs/epics/forge-workflow-lock-wiring/**
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - commands/**
  - agents/**
  - .claude/**
  - .github/**
  - src/cli.ts
  - src/cli/**
  - src/commands/**
  - src/orchestrator/lock.ts
  - src/orchestrator/lock.test.ts
  - src/orchestrator/lock-cli.ts
  - src/orchestrator/lock-cli.test.ts
  - src/orchestrator/decisions-ledger.ts
  - src/orchestrator/decisions-ledger.test.ts
  - src/orchestrator/ledger-cli.ts
  - "src/orchestrator/decision-id*"
  - "src/orchestrator/packets*"
  - "src/orchestrator/dispatch*"
  - "src/orchestrator/pm-dispatch*"
  - "src/orchestrator/index*"
  - src/run-report/**
  - src/schema/**
  - src/guard/**
  - package.json
  - pnpm-lock.yaml
  - README.md
  - docs/governance/**
  - "**/.forge/**"
  - sandbox-epic/**
  - pilot-local/**
---

# T01 — Wire the workflow-backed runner to forge lock for cross-run serialization

## Scope

Wire `workflows/forge-run-ticket.workflow.js` to the shipped `forge lock acquire | release` surface
(`src/orchestrator/lock-cli.ts`, PR #36) so the workflow runner cannot bypass the command orchestrator's cross-run
serialization. The workflow reaches Core/git/fs only through the typed `forge-core-runner` bridge and already runs
mutating `forge` CLI commands through it (`forge ledger append`, `forge run-report write`); `forge lock` is the same
class of call.

Two changes, both inside the workflow script:

1. **Preflight acquire (replaces the TOCTOU probe).** Replace the non-atomic existence probe at
   `workflows/forge-run-ticket.workflow.js:271-276` — `test -f "$forgeDir/lock.json"` → `PREFLIGHT_LOCK_EXISTS` — with
   an atomic `forge lock acquire` run through the bridge. The atomic create *is* the mutual exclusion; the probe was
   the same check-then-act race the command path just retired.
2. **Owner-checked release on terminal paths.** Add `forge lock release --run-id` on the PASS path (after ledger
   append + run-report write) and on the ownership-known ESCALATE / terminal-halt paths; hold the lock across the
   correction loop; never force-break or steal.

The lock primitive and CLI are invoked, never edited. If the work appears to need a change to `lock.ts`,
`lock-cli.ts`, the CLI router, the ledger modules, the guard, the schema, the `forge-core-runner` charter, or the
command orchestrator, **stop and report it in `deviations`** — that is a re-scope, not a workaround.

## Out of scope (halt-and-report if any becomes necessary)

- Editing `commands/forge-run-ticket.md` (already serialized, PR #38) or any command.
- Editing `agents/forge-core-runner.md` or any agent charter (`forge lock` is the same CLI class the bridge already
  runs, so no charter change is needed).
- Stale-recovery UX — any assisted or forced clearing of a stale or foreign lock (a `--force` / `break` path).
- Evidence-write ownership / `run_id` artifact enforcement.
- Worktree / shared-state architecture.
- Editing the lock primitive, the lock CLI, the ledger modules, the schema, the CLI router, or the guard.
- Status write-back; journal write; any outward action.

## Carried-forward decisions (ratified — keep these true)

1. The **epic lock is the primary cross-run serialization guarantee**; this extends it to the workflow path.
2. The **CAS ledger append remains defense-in-depth**.
3. The command orchestrator is already serialized (PR #38); the workflow runner is the last material unserialized path.
4. No stale-recovery UX; the workflow never force-breaks or steals a lock.
5. No evidence / `run_id` artifact-ownership enforcement (the `run_id` is the lock ownership key only).
6. No worktree / shared-state architecture.

## Discovery findings (inspected, not assumed)

Answers to the discovery questions, grounded in the current source:

1. **Which file invokes the run loop?** `workflows/forge-run-ticket.workflow.js` (the only file under `workflows/`).
2. **Direct Core or shell-out?** Neither directly: the workflow has no shell/fs of its own; every Core/git/fs touch
   routes through the typed `forge-core-runner` bridge (`runCore` → `agent({agentType:"forge-core-runner",
   schema:CoreRunnerResult})`), with explicit parse helpers (`runCoreJson`, `runCoreJsonResult`, `runGitText`,
   `runVerify`, `runCoreOk`, `writeForgeFile`).
3. **Where does it emit active-ticket / checkpoint / branch?** Preflight (Phase 1, ~`:251-279`) runs validate →
   dry-run → `git status --porcelain` clean check → the lock probe → `checkpointBase = rev-parse HEAD`. Phase 2
   (`active-ticket`, ~`:286-290`) emits and persists `active-ticket.json`. **Branch creation is NOT in the
   workflow** — the comment at `:266` states "Branch creation is the launcher's job"; the workflow assumes it is
   already on the run branch.
4. **Acquire vs active-ticket emission?** Acquire in preflight, after the clean-tree check, **before** the
   checkpoint capture (`:279`) and **before** active-ticket emission (Phase 2). It replaces the probe at `:271-276`.
5. **Acquire vs branch creation?** Branch creation precedes the workflow (launcher's job), so acquire-before-branch
   is **not achievable inside the workflow** — see Open decision #1. Acquire-in-preflight still serializes the run
   work (dispatch, ledger, run-report), which is the point of the lock.
6. **RUN_ID / SESSION_ID?** The workflow runtime forbids nondeterministic primitives (`Math.random`/`Date.now`/
   `new Date()` throw), so the workflow cannot mint a UUID inline. Receive `runId` / `sessionId` via `args`
   (launcher-provided, exactly like `args.repoRoot` / `args.epic` / `args.forgeBin` at `:55-57`); both are required
   (PM-ratified — no in-workflow or bridge minting).
7. **CLI or typed Core action?** The existing `forge lock` CLI, called through the existing bridge — no new Core
   action and no Core edit. `forge lock` emits a JSON envelope on both exit paths (like `dispatch` / `parse-agent`
   / `ledger append`), so `runCoreJsonResult` fits exactly: it returns `{exit, json}` and the caller branches on
   `json.ok` / `json.code`.
8. **How does the bridge execute commands?** `runCore(commandLine)` dispatches `forge-core-runner` with the
   `CoreRunnerResult` schema and returns a typed `{ok, exit, stdout, stderr, command}`; `exit` is authoritative.
   `forge lock` is a `forge` (Core) CLI call — not git/gh — so it is unaffected by the permissions hook's
   read-only-git restriction on the runner, the same as the `forge ledger append` / `forge run-report write` calls
   the bridge already makes.
9. **`LOCK_HELD`?** Stop before mutation — `escalate("PREFLIGHT_LOCK_HELD", { holder })`; no checkpoint, no
   active-ticket emission, no dispatch.
10. **`LOCK_MALFORMED`?** Stop before mutation — `escalate("PREFLIGHT_LOCK_MALFORMED", { errors })`; human
    investigation; never clobber or auto-clear.
11. **Workflow PASS?** Release after ledger append + run-report write (Phase 7), owner-checked by `runId`, before
    the success return.
12. **Workflow ESCALATE / terminal halt?** Release owner-checked **iff** the lock was acquired by this run — see
    the ownership-aware release in the wiring order. The workflow's `escalate()` helper (`:640-648`) is reached
    from both pre-acquire (preflight) and post-acquire points, so the release must be gated on an `acquired` flag.
    NOTE: the workflow's `escalate()` returns a structured evidence object and does **not** write an evidence
    run-report (unlike the command path's step 11) — see Open decision #3.
13. **CORRECT?** The lock is held across the correction loop automatically: the loop (`:329-424`) runs in-process
    and the acquire happens once in preflight; simply never release inside the loop. No code beyond not releasing.
14. **Malformed agent output / parse failure?** These already route to `escalate(*_OUTPUT_INVALID)`; with the
    ownership-aware release they release the lock (the run provably owns it via `runId`, and escalate is terminal).
15. **Hard interruption / process death?** The lock remains on disk; a later run sees it via `forge lock status`
    (report-only). Stale-recovery is a deferred slice; no force-break.
16. **Proof without unsafe live workflow execution?** A non-tautological **protocol-lock test against the workflow
    source** (see Proof) plus a manual execution-trace. Live workflow execution requires the workflow harness +
    real role agents + would take a real lock; it is the first-live-proof on a later governed workflow run, not
    part of this slice.
17. **Allowed / forbidden paths?** See front-matter.
18. **Install / artifact refresh after merge?** **No.** `scripts/install-commands.mjs` installs only `commands/`
    and `agents/` (verify-install tracks 10 files: 5 commands + 5 agents); `workflows/` is not installed. The
    workflow runs from the checkout, so no post-merge install refresh is needed (and `verify-install` is
    unaffected by this change).

## Wiring order (recommended)

1. **args:** read `runId` and `sessionId` from `args` alongside the existing `repoRoot` / `epic` / `forgeBin`
   (`:52-64`). Their absence is a hard error (mirroring the existing `repoRoot` / `epic` guards). The workflow does
   **not** mint identity itself (PM-ratified: launcher-provided only).
2. **Preflight acquire (replaces `:271-276`):** after the clean-tree check, run
   `forge lock acquire "$epic" --run-id "$runId" --session-id "$sessionId" --ticket "<id>" --branch "<branch>"
   --repo-root "$repoRoot"` through `runCoreJsonResult`. The selected ticket id and branch come from Core — the
   ticket id from `active-ticket`/`dry-run` and the branch from `git rev-parse --abbrev-ref HEAD` (the workflow is
   already on the launcher-created branch); see Open decision #4 on sourcing `--ticket`/`--branch` before vs. after
   active-ticket emission.
   - **success (`exit 0`, `json.ok === true`):** set an `acquired = true` flag; proceed to checkpoint capture,
     then active-ticket emission, then the loop.
   - **`json.code === "LOCK_HELD"`:** `escalate("PREFLIGHT_LOCK_HELD", { holder: json.holder })` — before any
     mutation.
   - **`json.code === "LOCK_MALFORMED"`:** `escalate("PREFLIGHT_LOCK_MALFORMED", { errors: json.errors })` — before
     any mutation; never clobber.
   - **any other non-zero / undecidable:** `escalate("PREFLIGHT_LOCK_ACQUIRE_FAILED", { acquire: json })` — before
     any mutation, fail closed.
3. **Hold across CORRECT:** the correction loop never releases; the lock is held for the whole run and released
   only on a terminal outcome.
4. **PASS release (Phase 7, after ledger append + run-report write):** `forge lock release "$epic"
   --run-id "$runId"` through `runCoreJsonResult`, owner-checked. A `LOCK_FOREIGN` / `LOCK_ABSENT` /
   `LOCK_MALFORMED` result is surfaced in the handoff (e.g. a `lock_release` field), **not** force-cleared.
5. **Owner-aware release on every terminal `escalate()`:** make `escalate()` (or a small wrapper it calls) release
   the lock **iff `acquired === true`**, owner-checked by `runId`, before returning the evidence object. Pre-acquire
   escalations (validate/dry-run/dirty-tree) do not release (nothing acquired). A foreign/absent/malformed release
   result is reported in the escalate evidence, never force-cleared.
6. **Never force-break.** No `--force` / stale-clear / foreign-clear path is added anywhere; a stale lock is left
   for a later run's `forge lock status` to report. (Deliberate parity with the command orchestrator.)

## Proof — how workflow-source wiring is verified without unsafe live execution

The workflow is executable JS, but executing it for proof would require the full workflow harness, real role
agents, and would take a real lock on a live epic — unsafe and non-deterministic for a unit gate. The proportionate,
deterministic proof (parity with the command path's accepted protocol-lock mechanism) is a **non-tautological
protocol-lock test against the workflow source** at `src/workflows/forge-run-ticket-workflow-lock.test.ts` (new
file; no test currently references the workflow). It reads `workflows/forge-run-ticket.workflow.js` as text and
asserts:

- **Present:** `forge lock acquire`, `forge lock release`, `--run-id`, `LOCK_HELD`, `LOCK_MALFORMED`, an `acquired`
  ownership flag, owner-checked release gated on that flag, and the `runId`/`sessionId` args plumbing.
- **Ordering:** the acquire call appears **before** the checkpoint capture (`rev-parse HEAD`) and **before** the
  active-ticket emission (index-of assertions over the source), and release appears on both the PASS path and the
  `escalate` path.
- **Absent (the non-tautological half):** the old `test -f "${forgeDir}/lock.json"` existence probe and the
  `PREFLIGHT_LOCK_EXISTS` escalate code — proving the TOCTOU probe was actually replaced, not merely supplemented.

This is supplemented by a **manual execution-trace** of the discovery answers against the edited source, recorded
in the run-report. The honest limitation (stated, not hidden): like the command path, the static test pins the
wiring text; the first end-to-end live proof is a later governed workflow run. "We read it and it seems fine" is
explicitly **not** sufficient — the absent-half assertions and the ordering assertions are what make the test bite.

> Open question for the implementer/PM (see Open decision #5): if a lightweight deterministic **typed-bridge unit
> test** (exercising the acquire/release branch logic with an injected fake `agent`/bridge) proves feasible without
> restructuring the workflow, it is preferred over the source-text test. Inspect first; if the workflow's top-level
> script shape makes injection a re-scope, the source-level protocol-lock test is the accepted proof.

## AI Instructions

- TDD-for-source: add the failing protocol-lock assertions first (they go red against the current probe-based
  source), then edit the workflow until they pass — both present and absent halves.
- Keep the edit minimal and surgical: replace the preflight probe, add the args plumbing, the `acquired` flag, and
  the two release sites; do not restructure unrelated phases or the typed-bridge helpers.
- Do not edit any Core module, the CLI router, the guard, the schema, the ledger, the lock primitive/CLI, any agent
  charter, or any command. A needed change there is a halt-trigger reported in `deviations`.
- Do not execute the workflow against a live epic, take a real lock, or run any force-break / stale-clear path.
- Run `pnpm test` and `pnpm typecheck`; both must stay green.

## Acceptance Criteria

1. **preflight acquire:** the workflow calls `forge lock acquire` (through the `forge-core-runner` bridge) in
   preflight, after the clean-tree check and **before** checkpoint capture and active-ticket emission, passing
   `--run-id`, `--session-id`, `--ticket`, `--branch`, `--repo-root`.
2. **TOCTOU probe gone:** the old `test -f "${forgeDir}/lock.json"` existence probe and the `PREFLIGHT_LOCK_EXISTS`
   code are no longer present in the workflow source.
3. **LOCK_HELD stops before mutation:** a `LOCK_HELD` acquire result escalates before checkpoint / active-ticket /
   dispatch and reports the holder.
4. **LOCK_MALFORMED stops before mutation:** a `LOCK_MALFORMED` acquire result escalates before mutation and never
   clobbers the on-disk lock; an undecidable acquire result also escalates fail-closed.
5. **run identity from args:** `runId` and `sessionId` are read from `args` (or the ratified fallback) and used as
   the acquire/release ownership key.
6. **CORRECT holds:** the correction loop never releases the lock; release happens only on a terminal outcome.
7. **PASS release:** on PASS, the workflow calls `forge lock release --run-id` after the ledger append and
   run-report write, owner-checked.
8. **terminal release is ownership-aware:** every `escalate()` reached **after** a successful acquire releases the
   lock owner-checked by `runId`; pre-acquire escalations do not (nothing acquired).
9. **release fail-closed:** a `LOCK_FOREIGN` / `LOCK_ABSENT` / `LOCK_MALFORMED` release result is reported in the
   handoff/evidence, never force-cleared.
10. **no force-break / no stale-recovery:** no `--force` / stale-clear / foreign-clear path is added; the workflow
    never force-breaks or steals a lock.
11. **no out-of-scope edits:** `commands/**`, `agents/**`, the lock primitive/CLI, the ledger/schema/guard/cli/
    run-report modules are untouched; only `allowed_paths` change.
12. **non-tautological proof:** `src/workflows/forge-run-ticket-workflow-lock.test.ts` asserts both the presence of
    the lock-wiring (acquire/release/`--run-id`/codes/ordering/release-on-both-terminals) and the absence of the old
    probe (`test -f`…`lock.json`, `PREFLIGHT_LOCK_EXISTS`).
13. `pnpm test` passes (existing suite plus the new workflow protocol-lock test). `pnpm typecheck` passes.

## Verification

- The new protocol-lock test in `src/workflows/forge-run-ticket-workflow-lock.test.ts` (present + absent + ordering)
  under `pnpm test`, plus `pnpm typecheck`.
- A manual execution-trace of AC 1–10 against the edited workflow source, recorded in the run-report.
- No live workflow execution; no real lock taken; no force-break / stale-clear; no outward action. Governed
  two-pass verifiers review diff + proof; PM judges.

## Resolved decisions (PM-ratified — implement to these)

1. **Acquire-before-branch — ACCEPTED.** Branch creation is the launcher's job and stays outside the workflow; do
   **not** move it in. Acquire-in-preflight is the correct serialization point for this slice — it protects the
   workflow's actual run work: checkpoint capture, active-ticket emission, agent dispatch, ledger append, and
   run-report write.
2. **`runId` / `sessionId` — launcher-provided via `args`, REQUIRED.** Read `args.runId` and `args.sessionId`;
   treat their absence as a hard error (mirroring the existing `repoRoot` / `epic` guards). Do **not** mint run
   identity inside the workflow, and do **not** call `node -e crypto.randomUUID()` from the bridge in this slice.
3. **Workflow ESCALATE — keep the existing shape.** Do **not** add evidence run-report writing on ESCALATE in this
   slice. Add the owner-checked release as part of the ownership-aware terminal `escalate()` path **only when
   `acquired === true`**; pre-acquire escalations do not release (nothing was acquired).
4. **`--ticket` / `--branch` source — ratified.** Source the ticket id from the **dry-run selected ticket** and the
   branch from **`git rev-parse --abbrev-ref HEAD`**, both **before** active-ticket emission. Do **not** reorder
   active-ticket emission ahead of acquire.
5. **Proof mechanism — ratified.** The required proof floor is the **non-tautological source-level protocol-lock
   test** + **manual execution-trace review**. A typed-bridge unit test is preferred **only if** it is feasible
   without restructuring the workflow; it is **not** mandatory for this slice and must not cause a re-scope.

## Implementation sequencing recommendation

After contract approval: a single governed `/forge-run-ticket` self-run on this epic — RED the workflow
protocol-lock test first, then wire the workflow (args plumbing → preflight acquire replacing the probe →
`acquired` flag → PASS release → ownership-aware escalate release), engineer → verifiers → PM, stop at the commit
gate. No install refresh post-merge (workflows are not installed). After this lands, both orchestrators — command
and workflow — are serialized by the same epic lock, closing the last material cross-run bypass.
