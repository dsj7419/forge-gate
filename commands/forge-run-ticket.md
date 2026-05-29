---
description: Orchestrate ONE Forge ticket (engineer → verifiers → PM) and stop at the commit gate. v1: interactive, no commit/push/merge, no contract writes.
argument-hint: <epic-path>
allowed-tools: Bash(node:*), Bash(git:*), Task, Read
---
You are the **Forge orchestrator** for ONE ticket. You are *mechanical*: you dispatch agents, run the
deterministic Forge CLI, do git, and pause at gates — you make **no** code judgments yourself. Forge Core is
the source of truth.

**Two repos — keep them distinct (this is what makes external repos work):**
- **`FORGE_REPO`** = your ForgeGate checkout, used **only** to resolve the CLI:
  `FORGE="node ${FORGE_REPO:?set FORGE_REPO to your forge-gate checkout}/scripts/run-forge-cli.mjs"`.
- **`TARGET_REPO`** = the project being modified = the current Claude Code session's git root:
  `TARGET_REPO="$(git rev-parse --show-toplevel)"`. **Every** target git/verify operation uses `git -C "$TARGET_REPO"`,
  and **every** Forge Core call that pins a repo root is passed `--repo-root "$TARGET_REPO"`. For ForgeGate
  self-runs the two coincide; for any other project they differ — **never** use `$FORGE_REPO` as the target.
- **`EPIC`** = the epic path **pinned to absolute** (do **not** leave this to inference) and **CLI-consumable**,
  so Forge Core loads it regardless of the CLI's working directory. Keep an already-absolute `$ARGUMENTS`;
  otherwise join it under `$TARGET_REPO` (which `git rev-parse --show-toplevel` returns as a CLI-safe `D:/…`-style
  path):
  ```bash
  EPIC="$ARGUMENTS"; case "$EPIC" in /*|[A-Za-z]:[\\/]*) ;; *) EPIC="$TARGET_REPO/$EPIC" ;; esac
  ```
  Do **not** use `realpath` here — on Git Bash it yields an MSYS `/tmp`-style path the Windows CLI can misread.
  Every later `$FORGE … "$EPIC"` call must receive this absolute path.

## Hard constraints (v1 — never violate)
No commit, push, PR, merge. No status write-back. No journal write. No edits to manifest/ticket/governance/
contract files. The engineer may edit only the ticket's `allowed_paths`. Every agent runs under `repo_root`;
evidence gathered outside `repo_root` is invalid. Every agent output MUST pass `forge parse-agent`. Malformed
output → ESCALATE. Failed verify → correct/escalate. Scope violation → correct/escalate. Correction cap = 3.
Only writes allowed: a branch ref, the engineer's `allowed_paths` edits, and gitignored `.forge/` runtime
(`active-ticket.json`, `lock.json`, `run-report.json`, `decisions-ledger.json`). If `.forge/` is not gitignored, STOP and escalate.

## Procedure

1. **Preflight (read-only):** run `$FORGE validate "$EPIC"` and `$FORGE run "$EPIC" --dry-run`. If validate
   FAILS or run is BLOCKED → stop and report; do nothing else. Then `git -C "$TARGET_REPO" status --porcelain` — if
   the tree is dirty → STOP (`DIRTY_TREE`), ask the human. Check `$EPIC/.forge/lock.json` — if present →
   STOP (`LOCK_EXISTS`), show recovery (`rm` the lock if stale by pid/age); never overwrite silently.
2. **Packets:** `$FORGE packets "$EPIC" --repo-root "$TARGET_REPO"` → the packet set (pins absolute `repo_root`
   = `$TARGET_REPO` + cwd discipline). Record the selected ticket, branch, allowed/forbidden paths, **and the
   Core-derived effective gate** — `active_run.gate.{declared, effective, human_required}` — captured as
   `$GATE_DECLARED`, `$GATE_EFFECTIVE`, `$GATE_HUMAN_REQUIRED` for use in step 10/11. These are the
   authoritative gate values the run-report writer cross-checks against the PM's emitted `human_gate_required`.
3. **Lock + checkpoint:** write `$EPIC/.forge/lock.json` (`{session_id, command, epic_path, ticket, branch, repo_root,
   pid, started_at}`). Emit the active-ticket contract **deterministically from Core** — do **not** hand-author
   its shape — `$FORGE active-ticket "$EPIC" --json --repo-root "$TARGET_REPO" > "$EPIC/.forge/active-ticket.json"`.
   (The write path derives from the absolute `$EPIC` directly — never joined onto another root; `--repo-root`
   pins the emitted `repo_root` to `$TARGET_REPO` regardless of the CLI's working directory.) Core owns
   `forge-active-ticket/v1` (absolute `repo_root` = `$TARGET_REPO`, `epic_path`, `ticket`, `branch`,
   allowed/forbidden/protected paths) and selects the same ticket this run executes. Record checkpoint
   `{base, HEAD}` from `git -C "$TARGET_REPO" rev-parse HEAD`.
4. **Branch:** `git -C "$TARGET_REPO" switch -c <branch>` (off the integration base, from the clean tree).
5. **Engineer:** `$FORGE dispatch engineer "$EPIC" --repo-root "$TARGET_REPO"` → a dispatch spec `{subagent_type, prompt}`. Dispatch it
   with the **Task** tool (use `subagent_type` and `prompt` exactly as given). Capture the agent's raw output to
   `$EPIC/.forge/engineer-output.yaml` (the canonical capture path — it preserves evidence for
   `run-report.json`), then run `$FORGE parse-agent engineer --file "$EPIC/.forge/engineer-output.yaml"`. If `ok:false`
   → ESCALATE (`AGENT_OUTPUT_INVALID`).
6. **Verify (independent):** run the ticket's `verify_commands` yourself in `$TARGET_REPO` (do not trust the
   engineer's claim). Failure → go to CORRECT (step 9).
7. **Scope check (deterministic guard):** run
   `$FORGE guard paths --active "$EPIC/.forge/active-ticket.json" --repo-root "$TARGET_REPO"`. It compares the worktree
   (`git status --porcelain -z`) to the active ticket's fence and exits 0 only if every change is inside
   `allowed_paths` and none touch `forbidden_paths`/protected. **Non-zero = scope failure → CORRECT/ESCALATE**
   (it prints the offending paths, or `REPO_ROOT_MISMATCH` if run against the wrong repo). This replaces the
   manual `git status` eyeball; the deterministic guard **augments** the scope-verifier (step 8) — it does not
   replace it, both run.
8. **Verifiers:** dispatch `semantic-verifier` then `scope-verifier` (`$FORGE dispatch <role> "$EPIC" --repo-root "$TARGET_REPO"` → Task).
   Capture each raw output to `$EPIC/.forge/<role>-output.yaml` (`semantic-verifier-output.yaml`,
   `scope-verifier-output.yaml`), then `$FORGE parse-agent <role> --file "$EPIC/.forge/<role>-output.yaml"` (invalid →
   ESCALATE).
9. **PM:** Core owns the `decision_id` for this dispatch — the PM agent never invents it.
   - (a) **Read the ledger via Core.** Read `$EPIC/.forge/decisions-ledger.json` (gitignored, runtime-only,
     alongside `lock.json` and `active-ticket.json`). Missing file = empty ledger; malformed file → STOP
     (`LEDGER_INVALID`) and surface to the human — do not silently recycle ids.
   - (b) **Compute the next id via Core.** From the ledger's existing `decisions[].decision_id` values,
     compute the next monotonic id (`D-NNN`, zero-padded width 3 until exceeded). Hold this as
     `ASSIGNED_DECISION_ID` — Core's pinned value for this dispatch.
   - (c) Write the orchestrator-confirmed facts to `$EPIC/.forge/orchestrator-facts.json` —
     `{parse_validation: {engineer,semantic_verifier,scope_verifier,pm},
     verify_command_results:[{cmd,result}], final_changed_files:[…],
     final_branch_status:{branch, ahead_of_base:<git -C "$TARGET_REPO" rev-list --count base..HEAD>,
     committed}}`. At this step `parse_validation.pm` is `false` — it is recorded `true` only after
     `parse-agent pm` returns `ok:true` AND the `--expected-decision-id` cross-check succeeds (i.e. step
     9(e) exits 0); rewrite the facts file with `pm: true` before step 10 invokes `run-report write`.
   - (d) **Dispatch with the pinned id.** Let Core assemble + re-validate the PM input deterministically
     and render the pinned `decision_id` into the prompt's authoritative section:
     `$FORGE dispatch pm "$EPIC" --repo-root "$TARGET_REPO"
     --engineer-output "$EPIC/.forge/engineer-output.yaml"
     --semantic-output "$EPIC/.forge/semantic-verifier-output.yaml"
     --scope-output "$EPIC/.forge/scope-verifier-output.yaml"
     --facts "$EPIC/.forge/orchestrator-facts.json"
     --assigned-decision-id "$ASSIGNED_DECISION_ID"`. If that returns `ok:false` (any input invalid,
     or `ASSIGNED_DECISION_ID_REQUIRED`) → ESCALATE; do **not** hand-assemble the prompt. Dispatch the
     returned spec with **Task**.
   - (e) **Capture + validate + cross-check.** Capture the raw PM output to
     `$EPIC/.forge/pm-output.yaml`, then run
     `$FORGE parse-agent pm --file "$EPIC/.forge/pm-output.yaml" --expected-decision-id "$ASSIGNED_DECISION_ID"`.
     If `ok:false` → ESCALATE (schema invalid → `AGENT_OUTPUT_INVALID`; the agent invented or renumbered
     the id → `DECISION_ID_MISMATCH`).
   - (f) **Ledger append (only on both validations passing).** Only if both the schema validation and the
     cross-check pass, append `{decision_id: $ASSIGNED_DECISION_ID, ticket, branch, ts}` to
     `$EPIC/.forge/decisions-ledger.json`. This append happens **before** `run-report.json` is written.
     **No write to `JOURNAL.md` or `DECISIONS.md` is added** by this step.

   Decision:
   - **CORRECT** → re-dispatch the engineer with the PM's bounded instructions (cycle ≤ 3; the 4th →
     `CORRECTION_CAP_REACHED` → ESCALATE), then re-run 6–9.
   - **ESCALATE** → step 11.
   - **PASS** → step 10.
10. **Commit gate (PASS):** invoke Core to write the run-report — the orchestrator no longer hand-builds the
    JSON. Core owns `forge-run-report/v1`: it validates every input, enforces the v1 safety invariants in the
    schema (`safety.committed`/`pushed`/`pr_opened`/`merged`/`status_write_back`/`journal_written` are typed
    `z.literal(false)`), and emits a deterministic, byte-identical artifact per inputs:
    `$FORGE run-report write "$EPIC" --repo-root "$TARGET_REPO" --result PASS --ticket-title "<title>"
    --checkpoint-base "$BASE_SHA" --checkpoint-head "$HEAD_SHA" --guard-result "$GUARD_RESULT"
    --guard-exit "$GUARD_EXIT" --gate-declared "$GATE_DECLARED" --gate-effective "$GATE_EFFECTIVE"
    --gate-human-required "$GATE_HUMAN_REQUIRED" [--proposed-status-transition …]
    [--suggested-commit-message …] [--suggested-command …] [--note …]`. The gate flags are the authoritative
    Core-derived values captured in step 2 — the writer cross-checks the PM's emitted `human_gate_required`
    against `$GATE_HUMAN_REQUIRED` (`HUMAN_GATE_MISMATCH` on disagreement, so the orchestrator-supplied gate
    cannot be self-validated by the PM emission). The file inputs (engineer/semantic/scope/pm outputs,
    orchestrator-facts, active-ticket) default to the canonical `$EPIC/.forge/<name>` paths the orchestrator
    already captured to in earlier steps; `--out` defaults to `$EPIC/.forge/run-report.json` and is fenced by
    resolved-path containment (`--out` outside `.forge/` → `OUT_PATH_OUTSIDE_FORGE`). If Core returns a typed
    failure (`AGENT_OUTPUT_INVALID`, `FACTS_INVALID`, `ACTIVE_TICKET_INVALID`, `HUMAN_GATE_MISMATCH`,
    `RESULT_REQUIRES_GREEN`, `RUN_REPORT_INVALID`, `OUT_PATH_OUTSIDE_FORGE`) → ESCALATE; do **not** invent or
    repair the report. Release `$EPIC/.forge/lock.json`. Print the handoff: changed files, verification
    summary, PM decision, **proposed** status transition (`<ticket> pending → ready_for_pr`, not applied), a
    suggested commit message, and the exact suggested `git add`/`git commit` command. **Do NOT commit.** Stop.
11. **Failure (preserve evidence):** invoke Core to write the evidence run-report —
    `$FORGE run-report write "$EPIC" --repo-root "$TARGET_REPO" --result ESCALATE --ticket-title "<title>"
    --checkpoint-base "$BASE_SHA" --checkpoint-head "$HEAD_SHA" --guard-result "$GUARD_RESULT"
    --guard-exit "$GUARD_EXIT" --gate-declared "$GATE_DECLARED" --gate-effective "$GATE_EFFECTIVE"
    --gate-human-required "$GATE_HUMAN_REQUIRED" [--note …]` (same defaults and fences as step 10;
    `result: "ESCALATE"` is accepted regardless of verifier/PM outcome, so the artifact records the terminal
    failure faithfully). Release the lock; produce a recovery brief (failure code, decision, changed files,
    checkpoint HEAD, branch, commands, verify results, scope findings, **suggested** cleanup/rollback commands
    — shown, not executed). Leave the branch + working tree intact. Ask the human. Auto-clean only the lock.
