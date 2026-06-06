---
schema_version: 1
id: T01
title: Wire the orchestrator command to forge lock for live cross-run serialization
kind: green
risk: high
change_class: feature
blast_radius: app
status: pending
depends_on: []
blocks: []
allowed_paths:
  - commands/forge-run-ticket.md
  - src/commands/forge-run-ticket-protocol.test.ts
  - docs/epics/forge-command-lock-wiring/**
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - workflows/**
  - agents/**
  - .claude/**
  - .github/**
  - src/cli.ts
  - src/cli/**
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

# T01 — Wire the orchestrator command to forge lock for live cross-run serialization

## Scope

Replace the hand-rolled lock management in `commands/forge-run-ticket.md` with calls to the shipped
`forge lock acquire | release | status` surface (`src/orchestrator/lock-cli.ts`, PR #36), so the epic lock becomes
the **live primary cross-run serialization guarantee** for the command orchestrator.

Three hand-rolled spots are replaced:

1. **Preflight (step 1)** — the non-atomic *check-then-act* existence check ("Check `$EPIC/.forge/lock.json` — if
   present → STOP") is removed. The atomic acquire is the authoritative gate; a separate pre-check is the TOCTOU
   this slice exists to close.
2. **Step 3** — the bespoke hand-write of `$EPIC/.forge/lock.json` is replaced by `forge lock acquire` with an
   orchestrator-generated `run_id`.
3. **Steps 10/11** — the unauthenticated hand-release is replaced by owner-checked `forge lock release --run-id`.

This is **command-text wiring plus its protocol-lock proof**. The lock primitive and its CLI are imported and
invoked, never edited. If the work appears to need a change to `lock.ts`, `lock-cli.ts`, the CLI router, the ledger
modules, the guard, or the schema, **stop and report it in `deviations`** — that is a re-scope, not a workaround.

## Out of scope (halt-and-report if any becomes necessary)

- Workflow-backed runner wiring (`workflows/**`). The workflow runner keeps its current behavior; the command
  orchestrator and the workflow runner will briefly diverge until a later slice wires the workflow.
- Stale-recovery UX — any assisted or forced clearing of a stale or foreign lock (a `--force` / `break` path).
  `forge lock status` reports a stale verdict; this slice never clears, steals, or force-breaks a lock.
- Editing the shipped `lock.ts` primitive, `lock-cli.ts`, the CLI router (`src/cli/**`), the ledger modules, the
  guard, or the schema.
- Evidence-write ownership / `run_id` artifact enforcement across run-report / active-ticket / orchestrator-facts.
- Status write-back; journal write.

## Carried-forward decisions (ratified — keep these true)

1. The **epic lock is the primary cross-run serialization guarantee**; this wiring is what makes that real for the
   command orchestrator.
2. The **CAS ledger append remains defense-in-depth**.
3. The residual CAS re-check-to-rename window is acceptable **only when lock wiring serializes appends** — document
   this where the acquire path is described in the command.
4. No stale-recovery UX yet — `status` reports staleness; it never clears or steals a lock.
5. No workflow wiring.
6. No evidence ownership / `run_id` artifact enforcement yet (the `run_id` is generated and used as the lock
   ownership key; broader artifact enforcement is deferred).

## The `forge lock` surface this wiring depends on (reference — do not edit)

From `src/orchestrator/lock-cli.ts` (PR #36). JSON to stdout; exit `0` ok, `1` typed failure, `2` usage error.

- `forge lock acquire <epic> --run-id <id> --session-id <s> --ticket <t> --branch <b> --repo-root <r>`
  - free → exit 0, prints `{ ok: true, record }` (the written `forge-lock/v1` record).
  - collision → exit 1, prints `{ ok: false, code: "LOCK_HELD", holder }`; the existing lock is **never** overwritten.
  - corrupt on-disk lock → exit 1, prints `{ ok: false, code: "LOCK_MALFORMED", errors }`; never clobbered.
  - `pid`/`host`/`acquired_ts`/`heartbeat_ts` are filled internally; the record is re-validated against the strict
    `forge-lock/v1` schema, so an ill-shaped `--ticket` etc. fails closed as `LOCK_MALFORMED` before any write.
- `forge lock release <epic> --run-id <id>` (owner-checked by `run_id`)
  - matching `run_id` → exit 0, `{ ok: true }` (lock cleared).
  - foreign `run_id` → exit 1, `{ ok: false, code: "LOCK_FOREIGN", holder }`; lock left intact.
  - absent → exit 1, `{ ok: false, code: "LOCK_ABSENT" }`.
  - corrupt → exit 1, `{ ok: false, code: "LOCK_MALFORMED", errors }`; never clobbered.
- `forge lock status <epic> [--heartbeat-ttl-ms <n>] [--acquire-ttl-ms <n>]`
  - report-only: prints `{ ok: true, verdict }` (holder + fresh/stale verdict + reasons + crossHost), exit 0 even
    when stale; absent → reports absent. **Never** clears or steals. Defaults: heartbeat TTL 5 min, acquire TTL 1 h.

## Wiring order (recommended — the answers to the contract questions)

> Q: *Where exactly should `forge lock acquire` happen? Before active-ticket emission?* — **Yes.** At the very top
> of **step 3**, before the active-ticket emission and before the branch creation in step 4. Acquire is the first
> mutation-adjacent action; nothing is written and no branch is created until it succeeds.

1. **Step 1 (preflight) — drop the manual lock pre-check.** Keep `validate`, `run --dry-run`, and the
   `DIRTY_TREE` check (all before acquire). **Strip out** the "Check `$EPIC/.forge/lock.json` — if present → STOP
   (`LOCK_EXISTS`)" check-then-act line; the atomic acquire in step 3 is the authoritative, race-free gate.
   *(Optional, non-authoritative: a `forge lock status "$EPIC"` read may be shown as a friendly early diagnostic,
   but it must NOT gate the run — see Open decisions. Default recommendation: omit it to keep the path minimal.)*
2. **Step 3 — generate the run identity, then acquire.** As the first actions of step 3, before active-ticket
   emission:
   - Generate a unique `RUN_ID` (the ownership/release key) and a `SESSION_ID` (diagnostic). Recommended recipe,
     using the `node` the command already shells and no dangerous operation:
     `RUN_ID="$(node -e 'process.stdout.write(crypto.randomUUID())')"` and likewise `SESSION_ID`.
   - `$FORGE lock acquire "$EPIC" --run-id "$RUN_ID" --session-id "$SESSION_ID" --ticket "<selected-ticket-id>"
     --branch "<branch>" --repo-root "$TARGET_REPO"` — using the ticket id and branch already recorded from
     `packets` (step 2). The acquire writes `$EPIC/.forge/lock.json` as a `forge-lock/v1` record.
   - **On acquire success (exit 0):** proceed to active-ticket emission, then checkpoint, then branch (step 4).
   - **On `LOCK_HELD` (exit 1):** STOP **before any mutation** — no active-ticket emission, no branch, no engineer
     dispatch. Report the holder from the `holder` field; tell the human another run owns this epic.
   - **On `LOCK_MALFORMED` (exit 1):** STOP before any mutation; surface the on-disk lock as corrupt and require
     human investigation. **Never** clobber or auto-clear it (stale-recovery is a deferred slice).
   - **On any other non-zero / undecidable acquire result:** STOP before any mutation; fail closed.
   - The bespoke hand-write of `lock.json` is removed; `forge lock acquire` is the only writer of the lock file.
3. **Steps 5–9 — hold across CORRECT.** The lock is held for the whole run. A **CORRECT** decision (step 9) keeps
   the lock held: the loop re-dispatches the engineer and re-runs steps 6–9 within the same run and never releases
   until a terminal outcome. Do not release between correction cycles.
4. **Step 10 (PASS) — owner-checked release after the run-report is written.** The ledger append (step 9f) has
   already succeeded by this point; write the PASS run-report first, then
   `$FORGE lock release "$EPIC" --run-id "$RUN_ID"`. Then print the handoff and stop. (Order: ledger append →
   run-report write → release.)
5. **Step 11 (ESCALATE / terminal failure) — owner-checked release after the evidence run-report is written.**
   Write the ESCALATE run-report first, then `$FORGE lock release "$EPIC" --run-id "$RUN_ID"`, then produce the
   recovery brief. A malformed agent output / parse failure routes here (halt → ESCALATE): because the orchestrator
   provably owns the lock (it holds `$RUN_ID`) and ESCALATE is a terminal stop state, an owner-checked release is
   safe and correct.
6. **Release is owner-checked and never forced.** On any release, if `forge lock release` returns `LOCK_FOREIGN`,
   `LOCK_ABSENT`, or `LOCK_MALFORMED`, the orchestrator **reports the anomaly to the human and does not
   force-clear** the file. Force-break / stale-clear is a deferred slice.
7. **Hard interruption / process death.** Uncatchable termination leaves the lock on disk by design; a later run
   sees it via `forge lock status` (stale verdict). Stale-recovery UX handles it later — this slice adds no
   force-break.

Also update the affected prose so the documented lock shape and recovery match Core: the **hard-constraints**
reference to the `.forge/` runtime files stays (lock.json is still written, now via `forge lock acquire`), and the
old "rm the lock if stale by pid/age; never overwrite silently" recovery hint is replaced by "see `forge lock
status` for a stale verdict; clearing a stale or foreign lock is not automated (a deferred slice)."

## Answers to the PM's contract questions (summary)

- **Where does acquire happen / before active-ticket emission?** Top of step 3, before active-ticket emission and
  before branch creation.
- **What `run_id`?** An orchestrator-generated unique id (`crypto.randomUUID()` via `node`), held for the whole run
  as the release ownership key.
- **Which fields to acquire?** `--run-id`, `--session-id`, `--ticket`, `--branch`, `--repo-root` (ticket id and
  branch from `packets`; repo-root = `$TARGET_REPO`). `pid`/`host`/timestamps are Core-filled.
- **On `LOCK_HELD`?** Stop before mutation; report the holder.
- **On `LOCK_MALFORMED`?** Stop before mutation; human investigation; never clobber.
- **On acquire success?** Proceed to active-ticket emission → checkpoint → branch.
- **Release on PASS?** After the run-report is written and the ledger append has succeeded (step 10), owner-checked.
- **Release on ESCALATE?** After the evidence run-report is written (step 11), owner-checked.
- **Does CORRECT keep the lock held?** Yes — held across all correction cycles; released only on a terminal outcome.
- **Malformed agent output / parse failure?** Halt → ESCALATE → owner-checked release (terminal stop + provable
  ownership).
- **User interruption / hard process death?** Lock remains; stale-recovery (deferred) handles it.
- **Deferred to stale-recovery UX?** Any force-break / stale-clear / foreign-clear; this slice is acquire/release +
  report-only status.
- **Tests/proof without dangerous operations?** A non-tautological protocol-lock test (below) + a manual reasoning
  walkthrough; no live orchestrator run, no real lock taken.
- **Allowed/forbidden paths?** See front-matter.

## Proof — how command-text wiring is verified without dangerous operations

`commands/forge-run-ticket.md` is a Markdown instruction file; there is no unit test that *executes* it. The
established mechanism (precedent: the capture-protocol-hardening slice) is a **non-tautological protocol-lock
test** that pins the load-bearing instruction text, asserting both presence of the new wiring and absence of the
old hand-rolled pattern, so the wiring change cannot silently regress.

Extend `src/commands/forge-run-ticket-protocol.test.ts` with a `lock-wiring contract` block that asserts:

- **Present:** `forge lock acquire`, `forge lock release`, `--run-id`, `LOCK_HELD`, `LOCK_MALFORMED`,
  acquire-before-active-ticket-emission, owner-checked release on PASS and on ESCALATE, hold-across-CORRECT,
  fail-closed-before-mutation, and "never force-break / never steal".
- **Absent (the non-tautological half):** the old hand-rolled lock pattern — i.e. the command no longer instructs a
  hand-write of the lock JSON object (e.g. the `started_at` bespoke field is gone) and no longer carries the
  check-then-act `LOCK_EXISTS` pre-check. This proves the TOCTOU path was actually removed, not merely supplemented.

The PM proof points (a second run fails before active-ticket emission; `LOCK_HELD` no-overwrite; `LOCK_MALFORMED`
stops safely; PASS releases the matching `run_id`; ESCALATE releases the matching `run_id`; CORRECT holds; parse
failure behavior explicit and safe; no stale-recovery added; no workflow wiring added) are additionally traced as a
**manual reasoning walkthrough** against the edited command text and recorded in the run-report. This honesty about
enforcement mirrors what the command already states: the discipline is enforced by instruction + a protocol-lock
test + disclosed-departure auditability, **not** by Core structurally preventing a non-compliant operator. The
first live, end-to-end proof is the next governed self-run *after* this lands (itself bootstrap-governed by the
previously-installed command text).

## verify-install / bootstrap implication (note — do not fix here)

`commands/forge-run-ticket.md` is an installed file. After this merges, `forge verify-install` will report it
**stale** until `pnpm install-commands` refreshes the installed copy. The run that *performs* this wiring is
governed by the **previously-installed** command text (hand-rolled lock), not by the new text — the expected
bootstrap gap. Neither the install refresh nor the bootstrap gap is in scope for this ticket.

## AI Instructions

- TDD-for-prose: add the failing protocol-lock assertions first (they go red against the current hand-rolled
  command text), then edit `commands/forge-run-ticket.md` until they pass — both the present-phrase and the
  absent-pattern assertions.
- Keep the edit minimal and surgical: replace the three hand-rolled spots and their prose references; do not
  restructure unrelated steps, and do not touch the capture-discipline section (its existing protocol-lock
  assertions must stay green).
- Do not modify any Core module, the CLI router, the guard, the schema, or any workflow/agent/settings file. A
  needed change there is a halt-trigger reported in `deviations`.
- Do not run the orchestrator against the live repo, take a real lock, or run any force-break/stale-clear path.
- Run `pnpm test` and `pnpm typecheck`; both must stay green.

## Acceptance Criteria

1. **acquire placement:** the command acquires via `forge lock acquire` at the top of step 3, **before**
   active-ticket emission and before branch creation, passing `--run-id`, `--session-id`, `--ticket`, `--branch`,
   `--repo-root`.
2. **second-run blocked before mutation:** the command specifies that a `LOCK_HELD` acquire result STOPS before any
   mutation (no active-ticket emission, no branch, no engineer dispatch) and reports the holder.
3. **no-overwrite:** the command relies on the atomic acquire (which never overwrites a held lock) and the old
   non-atomic check-then-write/hand-write of `lock.json` is removed.
4. **malformed-stops-safely:** a `LOCK_MALFORMED` acquire result STOPS before mutation and requires human
   investigation; the command never clobbers or auto-clears a corrupt lock.
5. **PASS releases matching run_id:** step 10 calls `forge lock release --run-id "$RUN_ID"` after the run-report is
   written and the ledger append has succeeded.
6. **ESCALATE releases matching run_id:** step 11 calls `forge lock release --run-id "$RUN_ID"` after the evidence
   run-report is written.
7. **CORRECT holds:** the command states that a CORRECT decision keeps the lock held across correction cycles and
   releases only on a terminal outcome.
8. **parse-failure explicit + safe:** malformed agent output / parse failure routes to halt → ESCALATE, where the
   owner-checked release runs (terminal stop + provable ownership); this is stated explicitly.
9. **release fail-closed:** a `LOCK_FOREIGN` / `LOCK_ABSENT` / `LOCK_MALFORMED` result on release is reported, not
   force-cleared.
10. **no stale-recovery added:** no force-break / stale-clear / foreign-clear path is added; `status` remains
    report-only.
11. **no workflow wiring added:** `workflows/**` is untouched; the divergence is acknowledged in the command/contract.
12. **non-tautological proof:** `src/commands/forge-run-ticket-protocol.test.ts` asserts both the presence of the
    lock-wiring phrases and the absence of the old hand-rolled lock pattern, and the pre-existing capture-discipline
    assertions stay green.
13. **scope + primitive untouched:** only `allowed_paths` are modified; `src/orchestrator/lock.ts`,
    `src/orchestrator/lock-cli.ts`, the CLI router, the ledger/schema/guard/run-report modules, and all
    workflow/agent/settings files are unchanged.
14. `pnpm test` passes (existing suite plus the extended protocol-lock assertions). `pnpm typecheck` passes.

## Verification

- The extended protocol-lock test in `src/commands/forge-run-ticket-protocol.test.ts` (present-phrase + absent-old-
  pattern), run under `pnpm test`, plus `pnpm typecheck`.
- A manual reasoning walkthrough of the PM proof points (AC 1–11) against the edited command text, recorded in the
  run-report.
- No orchestrator/workflow execution; no real lock taken on the live repo; no force-break/stale-clear; no
  destructive operation. Governed two-pass verifiers review diff + proof; PM judges.
