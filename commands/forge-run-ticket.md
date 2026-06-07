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

## Capture discipline (read first — non-negotiable)

Every agent output is captured by **one action per step**. For each agent you
dispatch (engineer, both verifier passes, PM), follow this exact sequence and
nothing else:

1. **dispatch the agent** — send the charter + packet.
2. **wait for the actual agent return** — do not proceed until the agent has
   actually returned its message to you.
3. **capture the exact returned text verbatim** — copy the agent's real returned
   message byte-for-byte. No edits, no normalization, no fixes.
4. **write that verbatim return to the canonical `.forge/<role>-output.yaml`
   file** — where `<role>` is `engineer`, `semantic-verifier`, `scope-verifier`,
   or `pm`.
5. **run `forge parse-agent`** on that file.
6. **continue only after parse succeeds** — if it does not parse, halt (below).

This is one capture per step. Dispatch is its own step; the verbatim write is its
own step; `forge parse-agent` is its own step.

### Prohibited (these void the run)

- **pre-writing** agent-output files before or alongside the dispatch.
- **summarizing** agent output into replacement YAML.
- **reconstructing** malformed output into something that parses.
- **composing** schema-valid output on behalf of an agent.
- **batching** dispatch + capture + parse into the same step.
- **validating synthesized output** — never run `forge parse-agent` against text
  you produced rather than captured verbatim from the agent.

### Halt behavior (halt — do not repair)

- If the agent output is **malformed**, parse it as malformed and **halt**
  (`AGENT_OUTPUT_INVALID`). Do not rewrite it to parse.
- If the agent output is **missing required fields**, **halt**.
- If tests fail, **report fail** — do not edit the report to pass.
- If a verifier rejects, **report reject** — do not soften or override it.
- **never rewrite an agent response** to make it parse, pass, or accept.

### Honesty about enforcement

This discipline is enforced by **instruction + a protocol-lock test**
(`src/commands/forge-run-ticket-protocol.test.ts`) plus disclosed-departure
auditability — **not** by Core structurally preventing a non-compliant capture.
A determined or careless operator can still synthesize output; the safeguard is
that any departure must be disclosed, and the lock test prevents the discipline
text from silently disappearing.

### verify-install implication

`commands/forge-run-ticket.md` is an **installed** file. After this hardening is
merged, an install refresh is expected: `forge verify-install` will report this
command **stale** until `pnpm install-commands` is re-run to refresh the
installed copy.

### Bootstrap note

This protocol text governs the run that executes it. The run that *produces* this
hardening is therefore governed by the **previously-installed** command text plus
the operator's memory rule — not by the new text. Only after merge + install
refresh does this command text itself enforce the capture protocol. That is the
**bootstrap** gap, and it is expected.

## Hard constraints (v1 — never violate)
No commit, push, PR, merge. No status write-back. No journal write. No edits to manifest/ticket/governance/
contract files. The engineer may edit only the ticket's `allowed_paths`. Every agent runs under `repo_root`;
evidence gathered outside `repo_root` is invalid. Every agent output MUST pass `forge parse-agent`. Malformed
output → ESCALATE. Failed verify → correct/escalate. Scope violation → correct/escalate. Correction cap = 3.
Only writes allowed: a branch ref, the engineer's `allowed_paths` edits, and gitignored `.forge/` runtime
(`active-ticket.json`, `lock.json`, `run-report.json`, `decisions-ledger.json`). `lock.json` is still written —
now **only** via the atomic `forge lock acquire` (step 3), never hand-authored. If `.forge/` is not gitignored,
STOP and escalate.

**Lock recovery (no force-break in this slice).** A lock left on disk by a hard interruption or process death is
seen by the next run via `forge lock status "$EPIC"`, which reports a **stale** verdict (report-only — it never
clears or steals). Clearing a stale or foreign lock is **not automated**: any force-break / stale-clear /
foreign-clear is a **deferred slice**, so this command **never force-breaks** a lock. (This is a deliberate
divergence from the workflow-backed runner, which keeps its current behavior until a later slice wires it.)

## Procedure

1. **Preflight (read-only):** run `$FORGE validate "$EPIC"` and `$FORGE run "$EPIC" --dry-run`. If validate
   FAILS or run is BLOCKED → stop and report; do nothing else. Then `git -C "$TARGET_REPO" status --porcelain` — if
   the tree is dirty → STOP (`DIRTY_TREE`), ask the human. **Do not pre-check the lock here.** The old
   check-then-act existence test was a TOCTOU race; the atomic `forge lock acquire` in step 3 is the authoritative,
   race-free gate. (An optional, non-authoritative `forge lock status "$EPIC"` read may be shown as a friendly
   early diagnostic, but it must **not** gate the run; the default is to omit it and let acquire be the only gate.)
2. **Packets:** `$FORGE packets "$EPIC" --repo-root "$TARGET_REPO"` → the packet set (pins absolute `repo_root`
   = `$TARGET_REPO` + cwd discipline). Record the selected ticket, branch, allowed/forbidden paths, **and the
   Core-derived effective gate** — `active_run.gate.{declared, effective, human_required}` — captured as
   `$GATE_DECLARED`, `$GATE_EFFECTIVE`, `$GATE_HUMAN_REQUIRED` for use in step 10/11. These are the
   authoritative gate values the run-report writer cross-checks against the PM's emitted `human_gate_required`.
3. **Acquire the lock, then checkpoint:** the epic lock is the **primary cross-run serialization guarantee** for
   this orchestrator. Acquire it **first** — at the very top of this step, **before active-ticket emission** and
   **before branch creation** (step 4). Acquire is the first mutation-adjacent action; nothing is written and no
   branch is created until it succeeds.
   - **Generate the run identity.** Mint a unique `RUN_ID` (the ownership / release key, held for the whole run)
     and a diagnostic `SESSION_ID`, using the `node` the command already shells:
     `RUN_ID="$(node -e 'process.stdout.write(crypto.randomUUID())')"` and likewise
     `SESSION_ID="$(node -e 'process.stdout.write(crypto.randomUUID())')"`.
   - **Acquire atomically via Core** — do **not** hand-write `lock.json`; `forge lock acquire` is the only writer:
     `$FORGE lock acquire "$EPIC" --run-id "$RUN_ID" --session-id "$SESSION_ID" --ticket "<selected-ticket-id>"
     --branch "<branch>" --repo-root "$TARGET_REPO"` (ticket id + branch from `packets` in step 2). It writes
     `$EPIC/.forge/lock.json` as a `forge-lock/v1` record; `pid`/`host`/timestamps are Core-filled. The acquire is
     atomic and **never overwrites a held lock**, which is what closes the old check-then-write TOCTOU.
   - **On acquire success (exit 0):** proceed to active-ticket emission below, then checkpoint, then branch (step 4).
   - **On `LOCK_HELD` (exit 1):** STOP **before any mutation** — no active-ticket emission, no branch, no engineer
     dispatch. Report the holder from the `holder` field; tell the human another run owns this epic.
   - **On `LOCK_MALFORMED` (exit 1):** STOP **before any mutation**; surface the on-disk lock as corrupt and require
     human investigation. **Never** clobber or auto-clear it (stale-recovery is a deferred slice).
   - **On any other non-zero / undecidable acquire result:** STOP before any mutation; fail closed.
   - *Why acquire is sufficient (carry-forward):* with the lock wiring serializing appends, the epic lock is the
     primary serialization and the CAS ledger append remains **defense-in-depth**; the residual CAS
     re-check-to-rename window is acceptable precisely because this acquire serializes the run.

   On acquire success, emit the active-ticket contract **deterministically from Core** — do **not** hand-author
   its shape — `$FORGE active-ticket "$EPIC" --json --repo-root "$TARGET_REPO" > "$EPIC/.forge/active-ticket.json"`.
   (The write path derives from the absolute `$EPIC` directly — never joined onto another root; `--repo-root`
   pins the emitted `repo_root` to `$TARGET_REPO` regardless of the CLI's working directory.) Core owns
   `forge-active-ticket/v1` (absolute `repo_root` = `$TARGET_REPO`, `epic_path`, `ticket`, `branch`,
   allowed/forbidden/protected paths) and selects the same ticket this run executes. Record checkpoint
   `{base, HEAD}` from `git -C "$TARGET_REPO" rev-parse HEAD`.
4. **Branch:** `git -C "$TARGET_REPO" switch -c <branch>` (off the integration base, from the clean tree). The lock
   acquired in step 3 is **held across** every subsequent step — including all CORRECT correction cycles
   (steps 5–9) — and is released only on a terminal outcome (PASS in step 10, ESCALATE in step 11). Never release
   between correction cycles.
Every agent step below obeys the **Capture discipline** above: dispatch the
agent → wait for the actual agent return → capture the exact returned text
verbatim → write it to `.forge/<role>-output.yaml` → run `forge parse-agent` →
continue only after parse succeeds. Never batch dispatch + capture + parse into
one step; never pre-write, summarize, reconstruct, compose, or validate
synthesized output.

5. **Engineer:** `$FORGE dispatch engineer "$EPIC" --repo-root "$TARGET_REPO"` → a dispatch spec `{subagent_type, prompt}`. Dispatch it
   with the **Task** tool (use `subagent_type` and `prompt` exactly as given). Wait for the actual agent return,
   then capture the agent's raw output **verbatim** to
   `$EPIC/.forge/engineer-output.yaml` (the canonical capture path — it preserves evidence for
   `run-report.json`; do not pre-write, summarize, reconstruct, or compose it), then run
   `$FORGE parse-agent engineer --file "$EPIC/.forge/engineer-output.yaml"`. Continue only after parse succeeds.
   If `ok:false` → **halt** / ESCALATE (`AGENT_OUTPUT_INVALID`, including missing required fields); never rewrite
   an agent response to make it parse.
6. **Verify (independent):** run the ticket's `verify_commands` yourself in `$TARGET_REPO` (do not trust the
   engineer's claim). If tests fail, **report fail** (do not edit the report to pass) → go to CORRECT (step 9).
7. **Scope check (deterministic guard):** run
   `$FORGE guard paths --active "$EPIC/.forge/active-ticket.json" --repo-root "$TARGET_REPO"`. It compares the worktree
   (`git status --porcelain -z`) to the active ticket's fence and exits 0 only if every change is inside
   `allowed_paths` and none touch `forbidden_paths`/protected. **Non-zero = scope failure → CORRECT/ESCALATE**
   (it prints the offending paths, or `REPO_ROOT_MISMATCH` if run against the wrong repo). This replaces the
   manual `git status` eyeball; the deterministic guard **augments** the scope-verifier (step 8) — it does not
   replace it, both run.
8. **Verifiers:** dispatch `semantic-verifier` then `scope-verifier` (`$FORGE dispatch <role> "$EPIC" --repo-root "$TARGET_REPO"` → Task).
   For each: wait for the actual agent return, then capture each raw output **verbatim** to
   `$EPIC/.forge/<role>-output.yaml` (`semantic-verifier-output.yaml`,
   `scope-verifier-output.yaml`), then `$FORGE parse-agent <role> --file "$EPIC/.forge/<role>-output.yaml"`.
   Continue only after parse succeeds (invalid → **halt** / ESCALATE). If a verifier **rejects**, **report
   reject** — do not soften, override, or rewrite the agent response.
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
   - (e) **Capture + validate + cross-check.** Wait for the actual agent return, then capture the raw PM
     output **verbatim** to `$EPIC/.forge/pm-output.yaml` (do not pre-write, summarize, reconstruct, or
     compose it), then run
     `$FORGE parse-agent pm --file "$EPIC/.forge/pm-output.yaml" --expected-decision-id "$ASSIGNED_DECISION_ID"`.
     Continue only after parse succeeds. If `ok:false` → **halt** / ESCALATE (schema invalid →
     `AGENT_OUTPUT_INVALID`; the agent invented or renumbered the id → `DECISION_ID_MISMATCH`); never rewrite
     an agent response to make it parse.
   - (f) **Ledger append (only on both validations passing).** Only if both the schema validation and the
     cross-check pass, append `{decision_id: $ASSIGNED_DECISION_ID, ticket, branch, ts}` to
     `$EPIC/.forge/decisions-ledger.json`. This append happens **before** `run-report.json` is written.
     **No write to `JOURNAL.md` or `DECISIONS.md` is added** by this step.

   Decision:
   - **CORRECT** → re-dispatch the engineer with the PM's bounded instructions (cycle ≤ 3; the 4th →
     `CORRECTION_CAP_REACHED` → ESCALATE), then re-run 6–9. The lock stays **held across** all correction cycles —
     do **not** release between cycles; release only on a terminal outcome.
   - **ESCALATE** → step 11.
   - **PASS** → step 10.

   **Malformed agent output / parse failure (any role).** A halt (`AGENT_OUTPUT_INVALID`, missing required fields,
   or a decision-id mismatch) routes to **ESCALATE → step 11**, where the **owner-checked** release runs. This is
   safe because the orchestrator provably owns the lock (it holds `$RUN_ID`) and ESCALATE is a terminal stop state.
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
    repair the report. **Release the lock — owner-checked — after the run-report is written and the ledger append
    (step 9f) has succeeded** (order: ledger append → run-report write → release):
    `$FORGE lock release "$EPIC" --run-id "$RUN_ID"`. The `forge lock release` surface is owner-checked by `run_id`
    and **never forced**: if
    it returns `LOCK_FOREIGN`, `LOCK_ABSENT`, or `LOCK_MALFORMED`, **report the anomaly to the human and do not
    force-clear** the file (force-break / stale-clear is a deferred slice). Print the handoff: changed files,
    verification summary, PM decision, **proposed** status transition (`<ticket> pending → ready_for_pr`, not
    applied), a suggested commit message, and the exact suggested `git add`/`git commit` command. **Do NOT commit.**
    Stop.
11. **Failure (preserve evidence):** invoke Core to write the evidence run-report —
    `$FORGE run-report write "$EPIC" --repo-root "$TARGET_REPO" --result ESCALATE --ticket-title "<title>"
    --checkpoint-base "$BASE_SHA" --checkpoint-head "$HEAD_SHA" --guard-result "$GUARD_RESULT"
    --guard-exit "$GUARD_EXIT" --gate-declared "$GATE_DECLARED" --gate-effective "$GATE_EFFECTIVE"
    --gate-human-required "$GATE_HUMAN_REQUIRED" [--note …]` (same defaults and fences as step 10;
    `result: "ESCALATE"` is accepted regardless of verifier/PM outcome, so the artifact records the terminal
    failure faithfully). **Release the lock — owner-checked — after the evidence run-report is written:**
    `$FORGE lock release "$EPIC" --run-id "$RUN_ID"`. As in step 10, release is owner-checked and **never forced**:
    a `LOCK_FOREIGN` / `LOCK_ABSENT` / `LOCK_MALFORMED` result is **reported to the human, not force-cleared**.
    Produce a recovery brief (failure code, decision, changed files, checkpoint HEAD, branch, commands, verify
    results, scope findings, **suggested** cleanup/rollback commands — shown, not executed). Leave the branch +
    working tree intact. Ask the human. The only auto-clean is the owner-checked lock release above.

## Hard rules (capture discipline)

- Obey the **Capture discipline**: dispatch → wait for the actual agent return →
  capture verbatim → write to `.forge/<role>-output.yaml` → `forge parse-agent`
  → continue only after parse succeeds. Never **batching** these into one step.
- Never **pre-writing**, **summarizing**, **reconstructing**, **composing**, or
  **validating synthesized output** in place of a verbatim agent capture.
- If tests fail, **report fail**. If a verifier rejects, **report reject**.
  **never rewrite an agent response** to make it parse, pass, or accept. Malformed
  or missing-required-fields output → **halt** (`AGENT_OUTPUT_INVALID`), do not
  repair.
- Enforcement is by instruction + the `src/commands/forge-run-ticket-protocol.test.ts`
  lock test + disclosed-departure auditability, not by Core structurally
  preventing a non-compliant capture. Because this is an installed command,
  `verify-install` reports it stale post-merge until `pnpm install-commands`
  refreshes it; the run that produces this edit is **bootstrap**-governed by the
  previously-installed text.
