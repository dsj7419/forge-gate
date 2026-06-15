# Closeout — Launcher cleanup CLEANUP_BLOCKED UX (F3)

**Status: SHIPPED.** `scripts/launch-workflow.mjs cleanup` now maps a cleanup-time `EPERM`/`EBUSY` on a Forge-owned
scratch launch directory to a typed `CLEANUP_BLOCKED` result with close-session/retry guidance, instead of
surfacing a raw OS stack with a non-zero exit. This closes **F3** from the launch-cwd operability run
(`wf_0c098781-275`): the launcher could throw a raw Windows busy/locked error when the scratch directory was still
held open as a live scratch-launched Claude session's cwd.

## Landing facts

| Field | Value |
|---|---|
| main SHA | `a446390` |
| Contract PR | #65 (squash `2e464d3`) |
| Implementation PR | #66 (squash `a446390`) |
| Decision | **D-001 PASS** |
| Post-merge `pnpm test` | **736 passed / 44 files** |
| `pnpm typecheck` | clean |
| `validate` | OK — 0 findings |
| `run --dry-run` | READY → T01 (expected — ticket `status:` stays `pending` on disk; deliberate no-write-back, not a regression) |

**Changed files (implementation):**
- `scripts/launch-workflow.mjs`
- `src/workflows/launch-workflow.test.ts`

## Design summary

- **Pure `classifyCleanupTeardownError(error, scratchPosix)` helper** (between extract-and-execute sentinel
  comments).
- **Maps only `EPERM`/`EBUSY`** to a typed `CLEANUP_BLOCKED` result; returns `null` for any other code.
- **Non-busy cleanup errors re-throw** (`if (blocked === null) throw error`) — no broad catch-all masking.
- The **`try/catch` wraps only the `fs.rmSync` cleanup teardown** — nothing else in the cleanup phase is guarded.
- **Reuses the existing `fail()` shape** (`ok:false` / `code` / `error`, exit 1) — consistent with the existing
  `CLEANUP_REFUSED_NOT_FORGE_OWNED` refusals.
- The `CLEANUP_BLOCKED` `error` **includes the blocked scratch path** and the guidance **"Close the
  scratch-launched Claude session, then re-run cleanup."**
- **Unchanged (byte-for-byte):** both `CLEANUP_REFUSED_NOT_FORGE_OWNED` refusals, ownership verification,
  `prepare`/create, `post-scan`, and the successful-cleanup emit.
- **No live held-directory repro used as a gate** — the `EPERM` was already observed during the F1/F2 sequence; the
  mapping is unit/protocol-tested via the extract-and-execute classifier.
- **No launcher redesign**, no new cleanup ownership model, no Core change.

## Evidence summary

- Governed `/forge-run-ticket` self-run reached **PASS at the commit gate** (orchestrator never committed).
- Semantic verifier **APPROVE**; scope verifier **APPROVE**; PM **PASS** (D-001).
- Decisions ledger: **D-001 appended** (before the run-report write).
- Run-report `safety.*` all **false** (committed / pushed / pr_opened / merged / status_write_back / journal_written).
- Epic lock **acquired then released owner-checked** (`run_id c68f58d5-…`, release `{ok:true}`).
- Deterministic scope **guard OK** (exit 0); changed files exactly the two allowed files.
- Post-commit fileset check clean (every commit).
- CI green on the implementation commit.
- Post-merge verification on `main`: tests 736/44, typecheck clean, validate 0 findings, dry-run READY.

## Strategic carry-forward

- **F3 is shipped.**
- **F2 is already closed out** (`docs/workflow-crash-path-owner-release-closeout.md`).
- **F1** (role-output persistence seam) **remains open and architectural** — it should **not** be resumed without a
  deliberate in-context proof plan (only an in-context workflow proof can answer it; no permission carve-out).
- **Stale-lock recovery UX** remains a **separate** deferred slice.
- **No permission carve-out** anywhere in this arc.
- **Next action: backlog reassessment, not automatic implementation.**
