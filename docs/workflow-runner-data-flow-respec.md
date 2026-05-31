# Workflow Runner — Typed Core-Runner Data-Flow Re-Spec (Discovery)

> Discovery doc. Author: senior engineer, 2026-05-31. Status: **for PM review — no implementation, no new
> epic, no source/workflow/charter edits, no branch/commit.** Produced after the workflow-runner skeleton
> self-run (5 correction attempts + a throwaway-clone proof attempt) surfaced a foundational missing contract:
> the **typed forge-core-runner result shape**. Evidence cited by `path:line`; the load-bearing platform fact
> is empirically verified below.

## 1. Current state

`main @ 17ab6c3` (skeleton contract landed, PR #22). The skeleton implementation is **not merged** — it lives
uncommitted on the run branch as four artifacts (`workflows/forge-run-ticket.workflow.js`,
`agents/forge-core-runner.md`, `.claude/settings.json`, `.gitignore`). Real repo clean; no outward action ever
taken. A disposable proof clone is built and ready at `D:/Projects/forge-workflow-runner-proof`.

The self-run iterated through five real, distinct defects — CLI-contract flags → decision-id tautology →
repo-portability (cwd) → missing `await` → **(this re-spec)** no typed core-runner return — each caught by
review or the proof-gate. Logic, decision-id provenance, portability, and async mechanics are now correct. The
remaining defect is structural and is the subject of this re-spec.

## 2. Root cause

The workflow reaches Core/git/fs **only** by dispatching a `forge-core-runner` agent via
`agent(instruction, {agentType:'forge-core-runner'})` — **with no `schema`**. Per the Workflow DSL, a
schemaless `agent()` resolves to the agent's **final message as a STRING**. The workflow then reads
`.ok`/`.verdict`/`.result`/`.exit`, calls `Array.isArray(...)`/`.map(...)`, and `Number.parseInt(...)` on those
strings — **nowhere is a core-runner return `JSON.parse`d** (two independent execution-trace audits confirmed
this, no discrepancy). Consequence: every PASS-gate signal (`verifyAllPass`, `semanticApprove`, `scopeApprove`,
`decisionIdVerified`, `ledgerAppendOk`) is computed off a string → `undefined`/`false`/`[]`/`NaN→0` → **`passGate`
is structurally unreachable; the run can only ever emit `ESCALATE`.** Plus empty `--ticket-title`, prose-bearing
`--checkpoint-*`, and a constant `D-001` decision-id.

This is **not a new idea** — it is an unimplemented part of the original design:
`docs/workflow-backed-runner-design.md:145-149` specified the core-runner returns `{exit, stdout}` and "the
script `JSON.parse`s stdout where the command emits JSON." Neither the schema nor the parsing was built.

## 3. Recommended core-runner result schema

```ts
type CoreRunnerResult = {
  ok: boolean;        // convenience: exit === 0
  exit: number;       // the ONLY authoritative success/failure signal
  stdout: string;     // exact command stdout, verbatim (parsed downstream per command)
  stderr?: string;    // exact stderr (empty when none)
  command?: string;   // the command that was run (provenance/debug)
};
```
The workflow parses `stdout` **explicitly** at one boundary (JSON for JSON-emitting commands, text otherwise),
uses **`exit`** as the success signal, and **never** reads domain fields from natural-language agent text.

## 4. Does `agent({schema})` support this? — **YES (empirically verified)**

A known-answer probe ran `agent('run `git -C … rev-parse HEAD` and report {ok,exit,stdout,stderr,command}',
{agentType:'forge-core-runner', schema: CoreRunnerResult})`. Result:
```json
{"ok":true,"exit":0,"stdout":"17ab6c308f79445bc2cbe386730ac4f100ae563b","stderr":"","command":"git -C D:/Projects/forge rev-parse HEAD"}
```
`typeof === "object"`, and **`stdout` is the real HEAD sha** (matches the actual `17ab6c3…`). So a schema'd
core-runner returns a typed object carrying real stdout. (Caveat per the earlier spike: structured output
enforces *structure*, not *semantics* — a careless/adversarial agent could return a structurally-valid object
with fabricated `stdout`. Mitigations: the agent actually runs the command; **Core re-validates every agent
output downstream**; and the run-report's `z.literal(false)` safety thesis is unaffected. The exit code is the
agent's report, same trust model as today's YAML path.)

## 5. Command stdout classification (what the workflow must parse)

| Command | stdout | Parse as |
|---|---|---|
| `forge validate <epic> --json` | JSON object `{ok, epicPath, findings, …}` | **JSON** |
| `forge run <epic> --dry-run --json` | JSON object | **JSON** |
| `forge packets <epic> --repo-root` | JSON object (RunPacketSet) | **JSON** |
| `forge active-ticket <epic> --json --repo-root` | JSON object | **JSON** (+ write to `.forge/active-ticket.json`) |
| `forge agent-schema <role>` | JSON object (role JSON-Schema) | **JSON** |
| `forge dispatch <role> <epic> --repo-root [pm flags]` | JSON `{role,subagent_type,mode,prompt}` or `{ok:false,…}` | **JSON** |
| `forge parse-agent <role> --json-file <p> [--expected-decision-id]` | JSON `{ok:true,data}` \| `{ok:false,code,errors}` | **JSON** |
| `forge guard paths --active <p> --repo-root --json` | JSON `{ok, findings}` | **JSON** |
| `forge ledger append <epic> --decision-id --ticket --branch` | JSON `{ok:true,ledger}` \| `{ok:false,code,errors}` | **JSON** |
| `forge run-report write <epic> …` | success: exit 0 (writes file, minimal stdout); failure: JSON `{ok:false,…}` (exit 1) / usage (exit 2) | **exit-signal**; read the report from `.forge/run-report.json`; parse stdout JSON only on non-zero exit |
| `git -C <repo> status --porcelain` | text lines (empty = clean) | **text** |
| `git -C <repo> diff --name-only` | text lines | **text** (split lines) |
| `git -C <repo> rev-list --count <b>..HEAD` | text (a number) | **text → int** |
| `git -C <repo> rev-parse HEAD` | text (a sha) | **text (trim)** |
| `pnpm test` / `pnpm typecheck` / `pnpm build` | verbose text | **exit-signal only** (`result = exit===0 ? 'pass' : 'fail'`) |

Key rules: forge JSON commands → use `--json` and `JSON.parse(stdout)`; git → text (trim/split); pnpm verify →
**exit code is the only signal**; run-report success is signalled by exit 0 and the report is **read from the
file**, not stdout.

## 6. Proposed workflow helper boundaries (parse once, consume typed)

```
runCore(forgeArgs)      -> CoreRunnerResult            // schema'd core-runner; the ONLY agent({schema}) bridge call
runCoreJson(forgeArgs)  -> JSON.parse(runCore(...).stdout)   // for the JSON commands above; throws/escalates on bad JSON or exit!=0
runCoreOk(forgeArgs)    -> runCore(...).exit === 0     // for exit-signal commands (run-report write)
runGitText(gitArgs)     -> runCore('git -C <repoRoot> …').stdout.trim()   // text
runGitInt(gitArgs)      -> parseInt(runGitText(...), 10)
runVerify(cmd)          -> ({cmd, result: runCore(cmd).exit === 0 ? 'pass' : 'fail'})
writeForgeFile(path,obj)-> assert(runCore('write <obj> to <path>').ok)    // verify the write succeeded
```
Role agents stay `await agent(prompt, {agentType:'forge-<role>', schema: roleSchema})` → typed role objects
(those already work). The script consumes only typed values from these helpers — **never** a raw agent string.
This is the single parse boundary the design intended.

## 7. Does this require `src/**`? — **NO (for the skeleton).**

- Every JSON the workflow needs is already emitted by the existing CLI under `--json` (`validate`, `run`,
  `guard`, `active-ticket`) or natively (`packets`, `agent-schema`, `dispatch`, `parse-agent`, `ledger append`).
- The `CoreRunnerResult` schema is a **local, workflow-defined JSON schema** (Q2 — local is sufficient for the
  skeleton; a Core-owned `forge core-runner-schema` emitter is an *optional* later nicety, not needed now).
- run-report success is read from `.forge/run-report.json` via a core-runner file read — no Core change.

**So the data-flow contract is still pure assembly over existing Core.** The only thing that was missing is the
workflow correctly *typing and parsing* the bridge — entirely inside `workflows/forge-run-ticket.workflow.js`
(+ a one-line charter note that the core-runner returns the `{ok,exit,stdout,stderr}` envelope). `src/**` stays
forbidden. (Honest deferral: if we later want the workflow to *not* trust a natural-language agent for `stdout`
fidelity at all, that needs a deterministic Core-side capture — a separate, `src/**`-touching future ticket,
explicitly **not** smuggled into this skeleton.)

## 8. Recommended contract path forward — **Option C (revise the skeleton contract, re-run clean)**

Per the three choices (A amend / B new epic / C revise+re-run): **C.** The skeleton isn't merged as
implementation, and the typed-bridge data-flow **is** what makes the skeleton real — it belongs *in* the
skeleton contract, not bolted on as a 6th patch. Concretely:
1. Amend `docs/epics/forge-workflow-runner-skeleton` T01 to add the **typed core-runner data-flow contract** as
   first-class requirements + acceptance criteria + the new proof gate (§11), via the PR-safe docs flow.
2. Reset the run branch to clean `origin/main` (discard the 5-attempt working artifacts as the *authored*
   deliverable; preserve them as reference/evidence under the epic `.forge/`).
3. Re-run the implementation under the amended contract — **front-loading the execution-trace review pair
   before any proof** (the lesson that just paid off).

The current artifacts' *correct* parts (portability, decision-id provenance, await, no-outward-stage, the 5 CLI
fixes) are well-understood and become the spec for the re-run; the data-flow contract is the new first-class
requirement.

## 9. Updated allowed_paths / forbidden_paths

**Unchanged** — the data-flow contract lives entirely in the existing allowed set:
```
allowed:   workflows/forge-run-ticket.workflow.js, agents/forge-core-runner.md, .gitignore, .claude/settings.json
forbidden: src/** (+ the existing set: commands/forge-run-ticket.md, the four forge-* charters,
           docs/**, package/lock/tsconfig/vitest, README, .github/**, .claude/settings.local.json, sandbox-epic/**, …)
```
The amended contract changes the **ticket body/ACs**, not the path fence.

## 10. Verification plan

- `pnpm test` / `pnpm typecheck` / `pnpm build` green (regression guard; no `src` change).
- **Front-loaded execution-trace review pair** (two independent agents) on the reworked workflow **before** any
  proof — assert: the core-runner is schema'd; every JSON consumer goes through `runCoreJson`; no field is read
  off a raw string; git→text, pnpm→exit-signal; file writes verified. Only proceed to the proof when both sign off.
- `pnpm install-commands` + `verify-install` (the new agent installs; 10/10 current).
- Throwaway-clone proof (the harness is built) with `args.repoRoot`/`args.epic`/`args.forgeBin` → the clone.

## 11. New proof gate (required for the re-spec to be "done")

The sandbox proof must show — and the run-report evidence must prove:
- the **typed `CoreRunnerResult` contract is used for every Core/git call** (no raw-text field reads),
- **all JSON stdout parsing is explicit** (`runCoreJson`), git is text, pnpm is exit-signal,
- commit-gate **PASS**,
- `agent_output_source.* = workflow_core_runner`,
- `safety.*` all false, `final_branch_status.committed` false,
- **no commit / push / PR / merge / status-write-back / journal-write** in the real repo,
- decision-id provenance non-tautological (ledger-derived `expectedDecisionId` → `--assigned-decision-id` +
  `--expected-decision-id`; ledger append gated; PASS gated on `ledgerAppendOk`).

## 12. Risks

1. **Structured-output fidelity:** the core-runner could in principle return a structurally-valid result with
   fabricated `stdout`. Mitigated by: the agent runs the real command; Core re-validates every agent output;
   exit-as-signal; and the run-report `z.literal(false)` thesis is untouched. A fully-deterministic capture is a
   deferred `src/**` ticket (§7).
2. **File-write reliability:** `.forge/**` writes must be verified (assert the core-runner's write result), and
   the `.forge` paths must be anchored so every dispatched core-runner shares the same root (use absolute
   `args.epic`).
3. **Proof cost/complexity:** the full nested loop is token-heavy; front-loading the review pair minimizes
   wasted proof-runs.
4. **Bypass/cwd:** keep the repo-portability fix; the proof runs against the clone via `args`.

## 13. Recommendation

**Adopt Option C.** Amend the skeleton contract to make the **typed core-runner `{ok,exit,stdout,stderr}`
data-flow contract** a first-class requirement (with the §6 helper boundary, §5 classification, and §11 proof
gate), reset to clean, and re-run with the review pair front-loaded before the proof. It needs **no `src/**`
change** (verified — the CLI already emits the JSON; the schema is local), so it remains pure assembly over
Core — the skeleton's premise holds; it was simply missing its bridge's type contract. This is a *good*
discovery: the proof discipline caught the exact class of defect a weaker process ships. The milestone is no
longer "make the script pass somehow" — it is "land the typed `forge-core-runner` bridge contract," after which
the runner is genuinely credible.

**Open decisions for Dan:** (1) ratify Option C (amend+reset+re-run) vs B (separate epic); (2) confirm the
local workflow-defined `CoreRunnerResult` schema for the skeleton (Core-owned emitter deferred); (3) confirm the
deferred deterministic-capture item (the only thing that would touch `src/**`) stays a separate future ticket.
