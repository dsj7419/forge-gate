# Discovery — first live proof of the workflow-backed runner's epic-lock path

> **Status:** discovery only. Designs the safest possible first live run of the workflow-backed runner that
> proves it acquires and releases the epic lock end-to-end through the harness — with **no** commit / push / PR /
> merge / status-write-back / journal-write. Authoring + design only; the live run itself is a later, explicitly
> human-gated step.

## Why

The cross-run concurrency arc is wired end-to-end on both execution paths: Core lock primitive (PR #34) → `forge
lock` CLI (PR #36) → command-orchestrator wiring (PR #38) → **workflow-runner wiring (PR #40)**. Both runners are
serialized by the same atomic, owner-checked epic lock.

But the proofs are not symmetric:

- The **command orchestrator** has exercised real `forge lock acquire` / owner-checked `forge lock release`
  **live** (every governed self-run since PR #38, including the run that shipped PR #40 itself).
- The **workflow-backed runner**'s lock wiring is proven only by the **non-tautological source-level
  protocol-lock test** + focused review (PR #40). Its *own* live acquire/release path — the workflow actually
  taking and releasing the lock through the `forge-core-runner` bridge, end-to-end through the workflow harness —
  **has not been exercised.** (The typed-bridge skeleton had a disposable-clone live proof at the PR #24 era,
  which proves the harness *can* run a full loop end-to-end; that predates the lock wiring.)

The disciplined next move is therefore to **prove the newly shipped behavior live before expanding the lock
system** (stale-recovery, evidence ownership, worktree shared-state all come after). This doc designs that proof.

## What "the workflow runner" actually is (inspected)

- The runner is `workflows/forge-run-ticket.workflow.js`, executed by the **`Workflow` tool** (the harness's
  deterministic workflow runner), not from a shell.
- It is parameterized entirely through `args` (never the session cwd): `args.repoRoot`, `args.epic`,
  `args.forgeBin`, and now **`args.runId` / `args.sessionId`** (required launcher-provided lock ownership keys,
  PR #40).
- It has no shell/fs of its own; every Core/git/fs touch routes through the typed `forge-core-runner` bridge
  (`runCore` → `agent({agentType:"forge-core-runner", schema:CoreRunnerResult})`).
- Phase order: `preflight` (validate → dry-run → clean-tree → **`forge lock acquire`**) → `active-ticket` →
  `engineer` (correction loop, cap 3) → `verify-and-guard` → `verifiers` → `pm` → `commit-gate-handoff`
  (ledger append → run-report write → **owner-checked release**). Terminal `escalate()` also releases
  owner-checked **iff `acquired === true`**.
- It performs **no** outward action by construction: there is no commit / push / PR / merge / status-write /
  journal stage anywhere, and the return carries `outward_action_taken: false`.

## The safety surface of a *live* run (the real hazards)

A live workflow run is materially different from running a read-only CLI subcommand — it dispatches **real
subagents** (engineer + two verifiers + PM + the core-runner) that read, run commands, and **edit files**:

1. **The engineer edits real files** in the target's `allowed_paths` (for sandbox-epic T01: `src/sandbox/**`).
2. **The core-runner runs real commands** in the target repo — `forge` CLI calls (validate/dispatch/lock/ledger/
   run-report), read-only git (`status`/`rev-parse`), `pnpm test`, and `.forge/**` file writes.
3. **A real lock is taken** at the target epic's `<epic>/.forge/lock.json`.
4. **Token cost** is real: a full happy-path loop runs five agents (engineer → 2 verifiers → PM, + the
   core-runner per bridge call).

None of these are *unsafe* if contained — but they must be contained. The design below contains them.

## Design — the safest first live run

### Isolation: a disposable sibling clone (established pattern)

Run the workflow against a **throwaway git clone** of forge-gate (e.g. a sibling `forge-workflow-live-proof`
directory), exactly as the typed-bridge proof did (`docs/workflow-runner-data-flow-respec.md` §10–11 — "the proof
runs against the clone via `args`"). The live repo is **never** the target. `args.repoRoot` / `args.epic` /
`args.forgeBin` all point into the clone; the clone is **discarded** after the proof.

- The clone is built once (human-gated: `git clone` is not a Class-1/2/3 shape, so the operator runs it with `!`),
  checked out at the target SHA, then `pnpm install && pnpm build` so `args.forgeBin` resolves to the clone's
  built CLI.
- Because the clone is disposable, the run can execute on the clone's default branch with uncommitted engineer
  edits — the workflow never commits, and **branch creation is the launcher's job, not the workflow's**, so no
  feature branch is required to exercise the lock. (Avoiding branch-create also avoids another `!` step.)

### Target: reuse `sandbox-epic` T01 (no new fixture)

`sandbox-epic` T01 — "Add a small pure `add()` helper with a test" (kind green, risk low, blast_radius local,
`allowed_paths: src/sandbox/**`, `verify_commands: pnpm test`, gate pr) — is the tracked sterile fixture built
for exactly this. It is ready, trivial, and self-contained, so a happy-path loop reaches **PASS** and exercises
the full lock lifecycle (acquire → … → ledger append → run-report → owner-checked release). **No dedicated proof
epic is needed** — which keeps this discovery-only (no code/fixture change).

### Two (optionally three) sub-proofs

**Sub-proof A — contention / fail-closed-before-mutation (cheap; run first).**
In the clone, take the lock with a *foreign* run id (`forge lock acquire … --run-id proof-foreign-holder …`),
then invoke the workflow with a *different* `args.runId`. Expect the workflow to **escalate
`PREFLIGHT_LOCK_HELD` before any mutation** — no active-ticket emission, no branch, no dispatch, no engineer
edits — and to report the holder. Then release the foreign lock. This proves the **serialization guarantee** and
the **fail-closed-before-mutation** property directly, at preflight cost only (no agent loop). It is the cheapest,
highest-signal proof and should run first.

**Sub-proof B — happy-path lock lifecycle (full loop).**
On a clean clone, launcher provides `args.runId` / `args.sessionId`, invoke the workflow against sandbox-epic
T01, and let it run engineer → verifiers → PM → **PASS**. Assert from the evidence:
- `lock.json` was created on acquire as `forge-lock/v1` with `run_id === args.runId`, **before** active-ticket
  emission (the active-ticket / checkpoint artifacts are timestamped/ordered after the lock exists);
- the lock was **held** across the loop (no release between phases / correction cycles);
- the lock was **released** at the terminal outcome — `lock.json` is gone after the run;
- the workflow return carries `lock_release: { ok: true }` and `outward_action_taken: false`;
- the run-report is `forge-run-report/v1` with `safety.*` all `false` and `final_branch_status.committed` false;
- decision-id provenance holds (`D-001`, cross-checked) and `agent_output_source.* = workflow_core_runner`
  (carried from the existing §11 proof gate).

**Sub-proof C — owner-checked release negative (optional; cheap, fold into A).**
While a lock is held, attempt `forge lock release … --run-id <wrong-id>` → expect `LOCK_FOREIGN`, lock intact.
Proves release is genuinely owner-checked (not just "remove the file").

### What the live run also incidentally validates

- **`forge-core-runner` under L3 is sufficient and enforced.** The workflow's bridge needs only `forge` CLI
  calls, read-only git, `pnpm test`, and `.forge` writes — all within the L3 read-only-git restriction. The live
  run is the first end-to-end exercise of the core-runner under the four-class hook's L3 grant.
- **The Workflow tool honors `permissions.deny`** in practice (previously a spike finding) — now on the real
  runner.

## Safety controls (why this is the *safest* first run)

- **Disposable clone, discarded after** — the live repo is never the target; no persistent state escapes.
- **No outward action is even reachable** — the workflow has no commit/push/PR/merge stage; `safety.*` is typed
  `false`; the return asserts `outward_action_taken: false`. The proof *confirms* this, it does not rely on it.
- **Human-gated entry** — building the clone (`git clone`) and invoking the `Workflow` tool both require explicit
  operator action; the proof does not start itself. This is consistent with the human-gate model.
- **The permissions hook still governs** every Bash git/gh in the session, including against the clone.
- **Front-load the cheap proof** — sub-proof A (preflight-only) runs first; commit to the token-heavy full loop
  (B) only after A confirms the gate.

## Open decisions for the PM

1. **Target epic:** reuse `sandbox-epic` T01 (recommended — sterile, ready, no new fixture) vs. author a
   dedicated proof epic (more isolation, but adds a fixture → makes this a contract).
2. **Isolation mechanism:** disposable sibling clone (recommended — matches the established proof pattern) vs. a
   git worktree vs. a throwaway branch in the live repo (rejected — touches live state).
3. **Branch handling in the clone:** run on the clone's default branch with uncommitted engineer edits
   (recommended — no branch-create `!` needed; the workflow never commits) vs. operator `!`-creates a feature
   branch in the clone.
4. **Proof scope:** A + B (recommended — A proves the serialization guarantee cheaply; B proves the full
   lifecycle) — with C folded into A; or B alone (happy path only); or all three explicitly.
5. **Artifact shape:** **discovery-only + an executed procedure** (recommended, since sandbox-epic is reused and
   no code changes) — i.e. land this doc, then on your go *execute* the proof and capture evidence; vs. a thin
   contract if you want a dedicated fixture or a tracked proof-result doc as a deliverable.
6. **Evidence capture & retention:** capture the clone's `run-report.json`, the `lock.json` lifecycle, and the
   workflow return into a gitignored evidence folder, summarized in a short proof-result note (landed or not —
   your call). The clone itself is discarded.

## Recommendation

Land this discovery via the light docs PR flow. Then, on your explicit go, **execute** the proof in a disposable
clone — **sub-proof A first** (cheap contention / fail-closed gate), then **sub-proof B** (full happy-path lock
lifecycle against sandbox-epic T01) — capture the evidence, and report. No formal ticket contract is required
under the recommended choices (reuse sandbox-epic, disposable clone, discovery-only); a thin contract is only
needed if you want a dedicated proof fixture.

Only after this live proof passes should we proceed, in order: **stale-recovery UX → evidence / `run_id` artifact
ownership → worktree / shared-state architecture → optional `workflow.js:295` comment cleanup.**

> **Disciplined principle, restated:** prove the newly shipped behavior live before building new capability on
> top of it. The workflow lock path is wired and lock-tested; this is the step that makes it *demonstrated*.
