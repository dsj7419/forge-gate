---
schema_version: 1
id: T01
title: Add workflow-backed runner skeleton
kind: green
status: pending
risk: high
change_class: feature
blast_radius: app
depends_on: []
blocks: []
allowed_paths:
  - workflows/forge-run-ticket.workflow.js
  - agents/forge-core-runner.md
  - .gitignore
  - .claude/settings.json
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - src/**
  - commands/forge-run-ticket.md
  - agents/forge-engineer.md
  - agents/forge-semantic-verifier.md
  - agents/forge-scope-verifier.md
  - agents/forge-pm.md
  - docs/**
  - docs/governance/**
  - package.json
  - pnpm-lock.yaml
  - tsconfig.json
  - vitest.config.ts
  - README.md
  - .github/**
  - .claude/settings.local.json
  - scripts/**
  - sandbox-epic/**
  - pilot-local/**
  - sandbox-local/**
  - .forge/**
  - "**/.forge/**"
  - "**/*.private.md"
---

# T01 — Add workflow-backed runner skeleton

## Scope

Add the first reviewed **workflow-backed runner skeleton** — the smallest governed step proving a Claude Code
dynamic workflow can drive the existing Forge Core to a safe commit-gate handoff, with the doctrine intact:
**the workflow executes, Forge Core governs, the human approves the outward action.**

This is **pure assembly over existing Core**. Discovery
(`docs/workflow-backed-runner-skeleton-discovery.md`) verified that a pure-JSON agent-output file validates
through both the YAML `--file` path and the structured `--json-file` path (JSON is a subset of YAML), so the
workflow persists structured `.forge/<role>-output.json` and feeds every existing Core command unchanged. **No
`src/**` change is required.** If implementation appears to need one, **stop and escalate** — the contract must
then be re-scoped.

Four tracked artifacts:

1. `workflows/forge-run-ticket.workflow.js` — the dynamic-workflow script (no outward-action stage).
2. `agents/forge-core-runner.md` — a narrow-grant agent charter (the bridge to Core + read-only git).
3. `.claude/settings.json` — a tracked `permissions.deny` backstop.
4. `.gitignore` — a narrow exception so only `.claude/settings.json` becomes tracked.

The acceptance evidence is a **manual proof run on `sandbox-epic`** to a commit-gate PASS (see Verification).

## Required architecture

Every trust boundary stays a **Core CLI call**, invoked by the `forge-core-runner` agent (the workflow script
has no filesystem or shell of its own):

```
forge validate · forge run --dry-run · forge packets · forge active-ticket · forge agent-schema
forge dispatch · forge parse-agent · forge guard paths · forge ledger append · forge run-report write
```

The workflow **must NOT own** any of these (they remain Core's):

- gate computation
- decision_id assignment
- ledger semantics
- agent-output schema validation
- path-fence decisions
- run-report safety attestation
- commit / push / PR / merge

The workflow owns only: phase ordering, the correction loop (cap 3), parallel verifier execution, capturing
the structured agent returns into variables, and assembling the handoff. **No outward-action stage exists in
the script.**

## Required workflow behavior (proof on `sandbox-epic` only)

Run the skeleton against **`sandbox-epic`** only (the sterile fixture). The branch is prepared by the
human/launcher **before** launch — the runner does not own branch creation (it stays on read-only git plus
Core CLI). The skeleton proves, in order:

1. preflight passes (`forge validate` + `forge run --dry-run` + clean-tree + lock-absence, via core-runner).
2. Core emits the gate-bearing active-ticket (`forge active-ticket --json`).
3. structured engineer capture works (`agent({agentType:'forge-engineer', schema})` → core-runner persists
   `.forge/engineer-output.json`).
4. Core validates the structured JSON (`forge parse-agent engineer --json-file`).
5. the target's verify commands run (via core-runner).
6. `forge guard paths` runs.
7. structured semantic-verifier capture works (persist + `parse-agent --json-file`).
8. structured scope-verifier capture works (persist + `parse-agent --json-file`).
9. structured PM capture works; the Core-pinned decision_id is echoed and cross-checked
   (`forge dispatch pm …` consumes the structured `.json` inputs unchanged; `forge parse-agent pm --json-file
   --expected-decision-id`).
10. Core records the decision (`forge ledger append`).
11. Core writes the run-report PASS (`forge run-report write …`).
12. the commit-gate handoff is returned by the workflow.

**No outward actions** occur: no `git commit`, no `git push`, no `gh pr create`, no `gh pr merge`, no status
write-back, no journal write.

## Required typed core-runner data-flow contract (first-class)

The workflow reaches Core/git/fs ONLY by dispatching `forge-core-runner`. It MUST call it **with a schema** and
receive a typed result object — never a raw natural-language string. (Empirically verified: a schema'd
`agent({agentType:'forge-core-runner', schema})` returns a typed object carrying the real command stdout. See
`docs/workflow-runner-data-flow-respec.md`.)

```ts
type CoreRunnerResult = {
  ok: boolean;        // convenience: exit === 0
  exit: number;       // the AUTHORITATIVE command success/failure signal
  stdout: string;     // exact command stdout, verbatim (parsed downstream per command)
  stderr?: string;    // exact stderr (empty when none)
  command?: string;   // the command run (provenance)
};
```

Rules (non-negotiable):
- `exit` is the authoritative success/failure signal for every Core/git/verify command.
- `stdout` is parsed **explicitly** by the workflow according to the invoked command (table below).
- The workflow MUST NEVER read `.ok`, `.exit`, `.result`, `.verdict`, arrays, maps, or any domain field from
  raw natural-language agent text. The role agents (engineer/verifiers/PM) keep returning typed objects via
  their own `schema`; the core-runner returns `CoreRunnerResult`.

### Command output classification (how `stdout` is parsed)

| Command | Parse `stdout` as |
|---|---|
| `forge validate <epic> --json` | JSON |
| `forge run <epic> --dry-run --json` | JSON |
| `forge packets <epic> --repo-root` | JSON |
| `forge active-ticket <epic> --json --repo-root` | JSON (+ write to `.forge/active-ticket.json`) |
| `forge agent-schema <role>` | JSON |
| `forge dispatch <role> <epic> --repo-root …` | JSON |
| `forge parse-agent <role> --json-file …` | JSON |
| `forge guard paths … --json` | JSON |
| `forge ledger append …` | JSON |
| `forge run-report write …` | exit-signal; on success read the report from `.forge/run-report.json`; parse stdout JSON only on non-zero exit |
| `git status` / `diff` / `rev-list` / `rev-parse` | text (trim / split lines) |
| `pnpm test` / `pnpm typecheck` / `pnpm build` | exit-signal ONLY (`result = exit===0 ? 'pass' : 'fail'`) |

### Required helper boundary (parse once, consume typed)

The workflow must route every Core/git call through typed helpers, e.g.:
```
runCore(forgeArgs)      -> CoreRunnerResult            // the ONLY schema'd core-runner bridge call
runCoreJson(forgeArgs)  -> JSON.parse(runCore(...).stdout)   // JSON commands; escalate on bad JSON or non-zero exit
runCoreOk(forgeArgs)    -> runCore(...).exit === 0     // exit-signal commands (run-report write)
runGitText(gitArgs)     -> runCore('git -C <repoRoot> …').stdout.trim()
runGitInt(gitArgs)      -> parseInt(runGitText(...), 10)
runVerify(cmd)          -> ({ cmd, result: runCore(cmd).exit === 0 ? 'pass' : 'fail' })
writeForgeFile(path,obj)-> assert(runCore('write … to <path>').ok)   // verify the .forge write succeeded
```
**All JSON parsing happens at the helper boundary; no downstream workflow step reads fields off raw agent text.**

## Required agent_output_source behavior

Because the `forge-core-runner` owns the deterministic capture and persistence of each structured output, the
run-report write passes, per role:

```
--agent-output-source-engineer workflow_core_runner
--agent-output-source-semantic-verifier workflow_core_runner
--agent-output-source-scope-verifier workflow_core_runner
--agent-output-source-pm workflow_core_runner
```

Emit `workflow_core_runner` **only** when the runner actually owns deterministic capture/persist (it does, on
this path).

## Required deny rules (`.claude/settings.json`)

A reviewed `permissions.deny` block covering at least:

```
Bash(git push:*)        Bash(git commit:*)      Bash(git merge:*)
Bash(gh pr create:*)    Bash(gh pr merge:*)     Bash(gh pr close:*)
Bash(gh:*)              Bash(powershell:*)      Bash(pwsh:*)
```

Also evaluate including `Bash(git reset --hard:*)` and `Bash(git push --force:*)` (explicit, even if implied by
`git push:*`). `.claude/settings.json` must contain **only** project-level runner safety policy — no local
machine paths, no personal configuration. The spike confirmed workflow agents honor `permissions.deny` and that
the PowerShell-through-Bash wrapper is blocked.

## Required `.gitignore` exception (narrow)

The current `.gitignore` ignores all of `.claude/`. Change it to track **only** `.claude/settings.json` while
keeping everything else in `.claude/` (including `.claude/settings.local.json`) untracked. Use the smallest
idiom, e.g. replace the `.claude/` line with:

```
.claude/*
!.claude/settings.json
```

`.claude/settings.local.json` must remain untracked (local-only machine configuration; never a tracked
artifact).

## Required `forge-core-runner` charter (`agents/forge-core-runner.md`)

A narrow agent charter. It may **only**:

- run existing Forge Core CLI commands (`node <forge>/dist/cli.js …` / `forge …`),
- run read-only git inspection (`git -C <repo> rev-parse/status/diff/rev-list/log`),
- persist workflow-owned structured outputs to `.forge/**`,
- read `.forge/**` evidence files.

It must **never**: perform an outward action; edit source files; create branches; commit / push / open or
merge a PR. If the charter grants `Bash`, it must state explicitly that `Bash` is only for the Forge CLI and
read-only git — the command-level backstop is the `.claude/settings.json` deny block (tool-name grants alone
cannot restrict a command).

## Proof-run sequence (orchestrator-performed — who runs the proof, and when)

The workflow proof is real acceptance evidence, and it must exist **before** semantic-verifier and PM judgment.
The sequence is explicit:

1. **Engineer** implements the four artifacts (`workflows/forge-run-ticket.workflow.js`,
   `agents/forge-core-runner.md`, `.gitignore`, `.claude/settings.json`). The engineer agent must **not** run
   the workflow proof as part of its implementation step.
2. After the engineer output parses and the implementation diff is present — and **before** the proof — the
   **orchestrator dispatches two independent execution-trace reviewers** over the workflow script. They must
   each confirm: (1) `forge-core-runner` is always called with the `CoreRunnerResult` schema; (2) every Core/git
   result is consumed through the typed helpers; (3) JSON stdout is parsed explicitly; (4) no field is read from
   raw agent text; (5) `passGate` is reachable only through real typed results; (6) decision-id provenance is
   non-tautological; (7) no outward-action stage exists. **If either reviewer finds a blocker, do not run the
   proof** — correct first. Only once both sign off, the **orchestrator** performs the manual workflow proof on
   `sandbox-epic` (install the new agent via `pnpm install-commands`, prepare the branch, launch
   `workflows/forge-run-ticket.workflow.js` against `sandbox-epic`, capture the Core-owned run-report as proof
   evidence) — **before** dispatching the semantic verifier. (For repo isolation the proof may run in a
   disposable clone via the workflow's `args.repoRoot`/`args.epic`/`args.forgeBin`; the real repo stays
   uncommitted.)
3. The **semantic verifier** reviews **both** (a) the implementation diff and (b) the workflow proof-run
   evidence.
4. The **PM** may PASS **only if** the proof-run evidence exists and shows:
   - commit-gate **PASS**
   - `agent_output_source.*` = `workflow_core_runner`
   - `safety.*` all false
   - `final_branch_status.committed` false
   - no commit / push / PR / merge / status write-back / journal write

If the proof-run evidence is absent or shows any outward action, the decision is **CORRECT** or **ESCALATE**,
never PASS.

## Out of Scope

- Any `src/**` change (pure assembly — a needed Core change is a halt-trigger, not a workaround).
- Editing `commands/forge-run-ticket.md` (the maintained Markdown fallback — no sunset) or the four existing
  `forge-*` charters.
- `PreToolUse` hooks (deferred; `permissions.deny` is the v1 backstop).
- Branch creation by the runner; multi-ticket behavior; promoting the runner to the default path; package /
  install distribution of the workflow or settings; running against any live epic.
- Any outward action, status write-back, or journal write.

## AI Instructions

- This is assembly over existing Core. Do **not** edit `src/**`. If a step seems to need a Core change, STOP and
  report it in `deviations` — that is a re-scope, not a workaround.
- **Typed bridge is mandatory.** `forge-core-runner` MUST be dispatched with the `CoreRunnerResult` schema; the
  workflow consumes Core/git results ONLY through typed helpers (`runCore`/`runCoreJson`/`runCoreOk`/
  `runGitText`/`runGitInt`/`runVerify`/`writeForgeFile`); JSON `stdout` is parsed explicitly at the helper
  boundary; `exit` is the success signal; **no field is ever read from raw natural-language agent text.** The
  role agents keep their own `schema`. Verify `agent({schema})` receives real JSON-Schema objects.
- **Before any sandbox proof run, the orchestrator dispatches two independent execution-trace reviewers** over
  the workflow (the seven checks in "Proof-run sequence"). If either finds a blocker, do not run the proof.
- Keep every trust boundary a Core CLI call. The workflow sequences; Core decides; the human acts outward.
- The workflow script must contain **no** `agent()` call or stage that issues commit / push / PR / merge.
- Track only `.claude/settings.json`; never `.claude/settings.local.json`; keep the `.gitignore` exception
  minimal. `.claude/settings.json` carries only project-level runner safety policy.
- The engineer agent must **not** run the workflow proof as part of its implementation step. The
  **orchestrator** performs the proof run on `sandbox-epic` after the engineer output parses and the
  implementation diff is present, **before** dispatching the semantic verifier (see "Proof-run sequence"
  below). It is acceptance evidence, not an automated verify command.
- After adding `agents/forge-core-runner.md`, an install refresh (`pnpm install-commands`) is expected and
  `verify-install` will report stale until it is run — this is the known installed-file pattern.
- Keep wording plain; do not reword strings other tests assert on.

## Acceptance Criteria

1. `workflows/forge-run-ticket.workflow.js` is tracked and contains no outward-action stage.
2. `agents/forge-core-runner.md` is tracked and grants only Forge-CLI + read-only-git + `.forge/**` writes.
3. `.claude/settings.json` is tracked and contains the `permissions.deny` ruleset.
4. `.claude/settings.local.json` stays untracked (it is in `forbidden_paths` and the `.gitignore` keeps it out).
5. `.gitignore` tracks only the intended `.claude/settings.json` exception (nothing else in `.claude/`).
6. `src/**` stays untouched.
7. `commands/forge-run-ticket.md` stays untouched.
8. The four existing `forge-*` charters stay untouched.
9. `pnpm test` passes.
10. `pnpm typecheck` passes.
11. `pnpm build` passes.
12. `pnpm install-commands` refreshes the new `forge-core-runner` agent.
13. `verify-install` reports current after the install refresh.
14. **`forge-core-runner` is always dispatched with the `CoreRunnerResult` schema** (`{ok, exit, stdout, stderr?, command?}`); the workflow never dispatches it schemaless.
15. **Every Core/git result is consumed through the typed helpers**; all JSON `stdout` parsing happens at the helper boundary; no downstream step reads `.ok`/`.exit`/`.result`/`.verdict`/arrays/objects off raw agent text.
16. `exit` is the authoritative success/failure signal; `pnpm test/typecheck/build` are treated as exit-signal only; git stdout is treated as text.
17. `.forge/**` writes are verified (the workflow asserts each `writeForgeFile` succeeded).
18. Decision-id provenance is non-tautological: `expectedDecisionId` is derived from the ledger (not from PM output) and passed to BOTH `dispatch pm --assigned-decision-id` AND `parse-agent pm --expected-decision-id`.
19. `forge ledger append` succeeds and run-report PASS is gated on `ledgerAppendOk` (+ both verifiers APPROVE + guard OK + verify pass).
20. Before the proof, two independent execution-trace reviewers confirm the seven checks; the proof runs only if both sign off.
21. A manual workflow proof on `sandbox-epic` reaches a commit-gate PASS (acceptance evidence).
22. The proof run's run-report has `agent_output_source.*` = `workflow_core_runner`.
23. The proof run's run-report has `safety.*` all false.
24. The proof run's run-report has `final_branch_status.committed` false.
25. No commit, push, PR, merge, status write-back, or journal write happens during the proof run.
