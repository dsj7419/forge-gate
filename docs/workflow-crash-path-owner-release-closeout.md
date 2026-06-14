# Closeout — Workflow crash-path owner-checked release (F2)

**Status: SHIPPED.** The workflow-backed runner now survives an unhandled post-acquire failure by attempting an
owner-checked lock release **before** any optional evidence behavior and returning a typed
`UNHANDLED_WORKFLOW_FAILURE` terminal — instead of letting the throw escape and orphan `lock.json`. This closes the
**F2** finding from the launch-cwd operability run (`wf_0c098781-275`): a substrate-denied persistence write threw,
bypassed `releaseLockIfOwned()`, and orphaned the lock on the clone's epic. The posture moved from *"orphan lock
after a substrate crash"* to *"typed terminal failure + owner-checked release."*

## Landing facts

| Field | Value |
|---|---|
| main SHA | `5e53c57` |
| Implementation PR | #63 (squash `5e53c57`) |
| Contract PR | #62 (squash `1ef9330`) |
| Decision | **D-001 PASS** |
| Post-merge `pnpm test` | **733 passed / 44 files** |
| `pnpm typecheck` | clean |
| `validate` | OK — 0 findings |
| `run --dry-run` | READY → T01 (expected — ticket `status:` stays `pending` on disk; deliberate no-write-back, not a regression) |

**Changed files (implementation):**
- `workflows/forge-run-ticket.workflow.js`
- `src/workflows/forge-run-ticket-workflow-crash-path.test.ts`

## Design summary

- **Catch-only lifecycle wrapper.** The workflow body (phases 1–7) runs inside a single
  `try { workflowOutcome = await (async () => { … })() } catch (error) { … }`; `return workflowOutcome;` ends the
  wrap. There is **no `finally`** release guard — `releaseLockIfOwned()` is already `acquired`-gated and idempotent,
  so a `finally` would be a no-op that only adds double-release / return-shape risk.
- **Release-first crash handler.** On a caught error the catch (1) attempts the owner-checked release via
  `releaseLockIfOwned()` inside its **own** guard (a release-time throw is recorded, never re-thrown), then (2)
  emits a best-effort `log()` breadcrumb only, then (3) returns the typed terminal.
- **No crash-path run-report requirement (T01).** The crash terminal is release + the typed outcome only — **no
  extra `.forge/` write** (PM-ratified report-free: the typed terminal is the forensic record for T01).
- **Distinct `buildUnhandledFailure(error, releaseResult, runId)` pure helper** (with `boundedErrorMessage`),
  placed between sentinel comments so a source-level test extracts and executes the real shipped builder — it does
  **not** overload `escalate()`'s semantics.
- **Typed terminal `UNHANDLED_WORKFLOW_FAILURE`:** `result: "ESCALATE"`, `outward_action_taken: false`,
  `human_gate_required: true`, `run_id`, `lock_release_attempted`, `lock_release_result` (the `releaseLockIfOwned`
  return, or `null` pre-acquire), `original_error_class`, `original_error_message`.
- **Sanitized / truncated error detail.** Class + a bounded message (cap 500); **no stack trace** in the terminal
  object. A foreign/absent/malformed release result is recorded verbatim, never overridden, never force-cleared.
- **No Core lock API changes.** `src/orchestrator/lock.ts` was forbidden; the existing owner-checked + idempotent
  release API (`forge lock release --run-id`, per #53) is consumed unchanged.
- **PASS and standard-ESCALATE behavior unchanged** — those outcomes flow out of the IIFE byte-for-byte unaffected.

## Evidence summary

- Governed `/forge-run-ticket` self-run reached **PASS at the commit gate** (orchestrator never committed).
- Semantic verifier **APPROVE**; scope verifier **APPROVE**; PM **PASS** (D-001).
- Decisions ledger: **D-001 appended** (before the run-report write).
- Run-report `safety.*` all **false** (committed / pushed / pr_opened / merged / status_write_back / journal_written).
- Epic lock **acquired then released owner-checked** (`run_id 716a8e50-…`, release `{ok:true}`).
- Post-commit fileset check clean (exactly the intended files), every commit.
- A bounded **test-tightening follow-up** landed before merge (`cc8a63f`): the lifecycle-wrap assertion was
  strengthened from a tautological whole-file `try`/`catch` match to anchors unique to this ticket
  (`workflowOutcome` async-IIFE-in-`try`, the lifecycle `catch (error)`, `return workflowOutcome;`).
- CI green on both the implementation commit and the test-tightening commit.
- Post-merge verification on `main`: tests 733/44, typecheck clean, validate 0 findings, dry-run READY.

## Strategic carry-forward

- **F2 is shipped.**
- **F1** (role-output persistence seam — the auto-mode classifier probabilistically denies the core-runner
  persisting a verifier verdict) **remains open and architectural.** Only an in-context workflow proof can answer
  it; do **not** implement the B2 spike from its INCONCLUSIVE result, and do **not** pursue a permission carve-out.
- **F3** (launcher cleanup EPERM → typed `CLEANUP_BLOCKED` + close-session hint) is the **next small follow-up.**
- **Stale-lock recovery UX** (force/clear of an already-orphaned lock from hard process death) remains a
  **separate** deferred slice.
- **No permission carve-out** anywhere in this arc.
