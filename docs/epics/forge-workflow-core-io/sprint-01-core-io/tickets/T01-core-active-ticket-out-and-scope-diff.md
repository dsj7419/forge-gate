---
schema_version: 1
id: T01
title: Core-owned active-ticket write and Core-fed scope diff so the workflow reaches full PASS
kind: green
risk: high
change_class: feature
blast_radius: app
status: pending
depends_on: []
blocks: []
allowed_paths:
  - src/cli/active-ticket.ts
  - src/cli/active-ticket.test.ts
  - src/cli/run.ts
  - src/cli/run.test.ts
  - workflows/forge-run-ticket.workflow.js
  - src/workflows/forge-run-ticket-workflow-lock.test.ts
  - docs/epics/forge-workflow-core-io/**
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - .claude/**
  - agents/**
  - commands/**
  - .github/**
  - src/cli.ts
  - src/guard/**
  - src/repo/**
  - src/orchestrator/lock.ts
  - src/orchestrator/lock-cli.ts
  - src/orchestrator/decisions-ledger.ts
  - src/orchestrator/ledger-cli.ts
  - "src/orchestrator/decision-id*"
  - "src/orchestrator/packets*"
  - "src/orchestrator/dispatch*"
  - "src/orchestrator/pm-dispatch*"
  - "src/orchestrator/index*"
  - src/run-report/**
  - src/schema/**
  - package.json
  - pnpm-lock.yaml
  - README.md
  - docs/governance/**
  - "**/.forge/**"
  - sandbox-epic/**
  - pilot-local/**
---

# T01 — Core-owned active-ticket write and Core-fed scope diff so the workflow reaches full PASS

## Scope

Close the two blockers the workflow live-proof rerun found
([`docs/workflow-live-proof-rerun-finding.md`](../../workflow-live-proof-rerun-finding.md)), so the workflow runner
reaches full happy-path PASS under the live hook for an external / clone `repoRoot` — without loosening the hook.

1. **Core writes the active-ticket byte-exact.** Add an `--out <path>` option to `forge active-ticket` so Core
   writes the `forge-active-ticket/v1` JSON directly to a file (Core-owned `fs` write), instead of the workflow
   handing JSON bytes to the `forge-core-runner` agent to "write exact bytes" (which corrupts Windows-path
   backslashes → invalid JSON → `guard paths` `ACTIVE_TICKET_INVALID`). The workflow calls `forge active-ticket …
   --out "$forgeDir/active-ticket.json"` and no longer prose-writes that artifact.
2. **The workflow feeds the scope verifier Core-owned changed-file facts.** The workflow already obtains the
   target-repo changed files from `forge repo snapshot` (PR #45). Inject that authoritative list into the
   scope-verifier's dispatch prompt so the verifier scope-checks from Core facts and does **not** shell git
   against a repo that isn't its Bash cwd. The scope-verifier charter already accepts a provided diff ("or the
   means to compute it"), so **no charter edit is required**.

If the work appears to need a hook change, a charter edit, a guard/`src/repo`/lock/ledger/schema/run-report edit,
or a Core dispatch/packets change, **stop and report it in `deviations`** — that is a re-scope.

## Out of scope (halt-and-report if any becomes necessary)

- Loosening the permissions hook (`.claude/**`); editing any agent charter or command.
- Editing the lock primitive/CLI, ledger modules, schema, run-report modules, the guard, or `src/repo` (the
  `repo snapshot` is invoked, not edited).
- Stale-recovery UX; evidence / `run_id` artifact-ownership broadly; worktree / shared-state; scratch-file
  isolation (kept separate unless strictly required to make this work); status write-back; journal write.
- Executing the A+B live re-proof (separate governed step after merge).

## Discovery findings (inspected, not assumed)

1. **How does `writeForgeFile` pass bytes through `forge-core-runner`?** `workflows/forge-run-ticket.workflow.js`
   `writeForgeFile` (~L203-216) serializes the object and tells the core-runner agent to "Write the following
   exact JSON bytes to the file … Do not alter, reformat, or pretty-print." The agent's write round-trips `\\` →
   `\` on Windows paths, corrupting the JSON.
2. **Which artifacts use that path?** `active-ticket.json` (L347), `orchestrator-facts.json` (L538, L616), and the
   role outputs via `persistAndValidateRole` (L254): engineer/semantic/scope/pm `-output.json`.
3. **Is active-ticket the only artifact that must be Core-written now?** **Yes, for this fix.** Only
   `active-ticket.json` carries a backslashed Windows path (`repo_root`) and is the one observed corrupt; the
   others are forward-slash content (changed-file paths, branch names, evidence pointers) and do not currently
   corrupt. The general `writeForgeFile`-via-prose fragility is noted as a follow-up, not fixed here.
4. **Does a Core command already write active-ticket, and can it gain `--out`?** `src/cli/active-ticket.ts`
   (`emitActiveTicket`) returns the validated object; the `active-ticket` route in `src/cli/run.ts` prints it.
   Add `--out <path>` handling at the CLI IO layer (the `active-ticket` route in `run.ts`) so Core writes the JSON
   to the path byte-exact; keep `active-ticket.ts` pure.
5. **Smallest Core-owned artifact IO surface that fixes the corruption?** `forge active-ticket … --out <path>`
   (Core `fs.writeFileSync` of the same JSON). No new generic write command needed.
6. **How does `guard paths` consume active-ticket.json?** It reads + `JSON.parse`s the `--active` file; invalid
   JSON → `ACTIVE_TICKET_INVALID`. With the byte-exact `--out` write the file is valid → the guard parses it and
   (spawning git internally against `repoRoot`) reports scope correctly → `guardOk` true.
7. **How does the scope verifier currently inspect git / changed files?** Its charter says inputs are
   "`git diff --name-status` for the change (or the means to compute it)." In the proof, the dispatch carried no
   diff, so the agent tried to compute it by running git — which the hook denied against the clone — so it failed
   closed.
8. **What does the scope verifier need to APPROVE without shelling git?** The authoritative target-repo
   changed-file set (name-status equivalent) for `repoRoot`, provided in its dispatch.
9. **Should Core emit a target-repo diff artifact?** Not a new one — the workflow already has the Core-produced
   `repo snapshot` `changed_files` for the target `repoRoot`. Reuse it.
10. **Should the scope verifier receive that in its dispatch packet?** Yes — the workflow appends the Core
    `changed_files` (clearly labeled authoritative for `repoRoot`) to the scope-verifier prompt before dispatch
    (mirroring how it appends correction feedback to the engineer prompt). No Core dispatch/packets change.
11. **One ticket or split?** **Recommend one ticket.** Both fixes are small, both land in the workflow, blocker 2
    reuses the existing `repo snapshot`, and **neither alone reaches PASS** (blocker 1 fixes `guardOk`; blocker 2
    fixes `scopeApprove`; PASS needs both) — so the payoff is joint. (Alternative: split into T01 active-ticket
    `--out` + T02 scope-diff injection; see Open decisions.)
12. **Allowed / forbidden paths?** See front-matter. `.claude/**`, `agents/**`, `src/guard/**`, `src/repo/**`,
    Core dispatch/packets/lock/ledger/schema/run-report are **forbidden** (no hook/charter/Core-primitive edits).

## Required behavior

### Blocker 1 — `forge active-ticket … --out <path>`
- `forge active-ticket <epic> --json --repo-root <r> --out <path>` writes the `forge-active-ticket/v1` JSON to
  `<path>` byte-exact (Core `fs` write), creating parent dirs as needed; exit 0 on success. Without `--out`,
  behavior is unchanged (prints JSON). On a blocked/no-ready-ticket selection, it still fails (no file written).
- The workflow calls `forge active-ticket … --out "$forgeDir/active-ticket.json"` (via the core-runner) and
  **stops** routing `active-ticket.json` through `writeForgeFile`/the prose byte-write.

### Blocker 2 — Core-fed scope diff
- The workflow appends the Core-produced authoritative changed-file list for `repoRoot` (from the handoff
  `repo snapshot`'s `changed_files`) to the scope-verifier's dispatch prompt, clearly labeled as the authoritative
  Core diff for `repoRoot` to be used instead of running git.
- The scope verifier consumes that provided list (already within its charter); it must not need raw git.

## AI Instructions

- TDD: write the failing Core unit test for `active-ticket --out` first (incl. a Windows-style backslash
  `repo_root` round-trips to valid on-disk JSON), implement, then the failing workflow protocol assertions, then
  rewire the workflow.
- Keep edits surgical and within `allowed_paths`. Do not edit the hook, any charter, the guard, `src/repo`, or any
  Core dispatch/packets/lock/ledger/schema/run-report module. A needed change there is a halt-trigger reported in
  `deviations`.
- Do not loosen the permissions hook. Do not run the live workflow proof (separate step).
- Run `pnpm test` and `pnpm typecheck`; both must stay green.

## Acceptance Criteria

1. **active-ticket --out writes byte-exact valid JSON:** `forge active-ticket … --out <path>` writes the
   `forge-active-ticket/v1` JSON to `<path>`; the file is valid JSON and round-trips a Windows-style backslash
   `repo_root` correctly (a unit test parses the written file and asserts `repo_root` is intact).
2. **--out is additive:** without `--out`, `active-ticket` behavior is unchanged (prints JSON, writes nothing);
   `--out` on a no-ready-ticket selection writes no file and fails.
3. **router/usage:** `--out` is wired in the `active-ticket` route and listed in `USAGE`; covered in `run.test.ts`.
4. **workflow uses --out for active-ticket:** the workflow writes `active-ticket.json` via `forge active-ticket …
   --out` and no longer routes it through `writeForgeFile`/the prose byte-write.
5. **scope diff fed from Core:** the workflow injects the Core `repo snapshot` `changed_files` (authoritative for
   `repoRoot`) into the scope-verifier dispatch prompt.
6. **lock + snapshot wiring preserved:** `forge lock acquire` ordering (after clean-tree, before active-ticket
   emission/checkpoint), owner-checked release, hold-across-CORRECT, and the `repo snapshot`-based preflight/handoff
   reads all remain intact (existing lock + snapshot protocol assertions stay green).
7. **non-tautological proof:** the workflow protocol test asserts the **presence** of `active-ticket … --out` and
   the Core-diff-into-scope-verifier wiring, and the **absence** of the prose byte-write for active-ticket (e.g.
   no `writeForgeFile("active-ticket.json"` call).
8. **scope:** only `allowed_paths` change; the hook, charters, commands, guard, `src/repo`, and Core
   dispatch/packets/lock/ledger/schema/run-report modules are untouched.
9. `pnpm test` passes (existing suite + the new tests). `pnpm typecheck` passes.

## Verification

- New `active-ticket --out` unit test (byte-exact + Windows-backslash `repo_root`) + `run.test.ts` route coverage.
- Extended `src/workflows/forge-run-ticket-workflow-lock.test.ts` (present: `active-ticket … --out`, Core diff →
  scope verifier; absent: `writeForgeFile("active-ticket.json"`; lock + snapshot assertions still green).
- Governed two-pass verifiers review diff + proof; PM judges. **No live workflow execution in this ticket.**
- **Post-merge (separate governed step):** re-run the A+B live proof in the disposable clone:
  - **A:** foreign lock → workflow reaches `forge lock acquire` → `PREFLIGHT_LOCK_HELD` before mutation.
  - **B:** clean full workflow run → **PASS** → acquire/hold/owner-checked release → no outward action; run-report
    `safety.*` all false, `committed`/`pushed`/`pr_opened`/`merged`/`status_write_back`/`journal_written` false.

## Open decisions (for the PM)

1. **One ticket vs. split.** Recommend **one** (small, joint payoff, both in the workflow). Alternative: T01
   active-ticket `--out` + T02 scope-diff injection (two governed runs; neither reaches PASS alone).
2. **Generalize the artifact write?** Only `active-ticket` is fixed here (the proven corruption). Whether to move
   `orchestrator-facts` / role-output writes off the prose byte-write (robustness, not a current corruption) is a
   noted follow-up — confirm leaving it out of this ticket.
3. **Scope-verifier charter clarification.** No edit is required (charter accepts a provided diff). Optional later
   nicety: clarify the charter to "prefer the provided Core diff; only compute if absent." Out of scope here
   (agents/** forbidden).

## Implementation sequencing recommendation

One governed `/forge-run-ticket` self-run on this epic — RED the `active-ticket --out` unit test → implement →
RED the workflow protocol assertions → rewire the workflow (active-ticket via `--out`; Core diff → scope verifier)
→ engineer → verifiers → PM → stop at the commit gate. After merge (no install refresh — neither the CLI surface
nor the workflow is installed), **re-run the A+B live proof** in the disposable clone at
`D:/Projects/forge-workflow-live-proof` to confirm full workflow PASS. Only then proceed to stale-recovery UX,
scratch-file isolation, evidence/`run_id` ownership, and worktree/shared-state.
