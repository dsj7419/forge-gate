# Workflow-Backed Runner — Discovery

> Discovery doc. Author: senior engineer, 2026-05-31. Status: **for PM review — no implementation, no epic,
> no branch, no commit.** Reconciles `docs/workflow-backed-runner-phase2-design.md` (accepted baseline,
> 2026-05-29 @ `c34e8c2`) and `docs/workflow-era-architecture-audit.md` against the now-shipped state
> (`main @ c2a22c8`, B1/B2/1c all merged). Evidence cited by `path:line`; unverified platform facts labelled
> **(UNVERIFIED)**.

---

## 0. Current state (the prerequisite chain is COMPLETE)

`main @ c2a22c8` · 535 tests / 37 files green · typecheck/build PASS · verify-install OK · tree clean.

The Phase 2 design was written against `c34e8c2` and recommended **B1 gate provenance** as "the next ticket,"
with the explicit pre-runner sequence **B1 → B2 (decision-id) → 1c (source-tracking) → runner.** As of today
**that entire chain is shipped:**

- **B1 gate provenance** — PR #14 (`4863629`). active-ticket is the Core-owned gate source; `run-report write`
  reads `active-ticket.gate`; `--gate-*` are optional cross-checks; `GATE_SOURCE_MISSING` fail-closed.
- **B2 decision-id assignment + ledger append** — PR #18 (`9ea9f77`). `forge dispatch pm` assigns via
  `nextDecisionId` (`dispatch.ts:253` `buildPmDispatch` stays pure); `forge ledger append` records via
  `appendDecision`; C4 exact-next guard live.
- **1c run-report source tracking** — PR #20 (`c2a22c8`). `agent_output_source` optional per-role field, enum
  `yaml_text | structured_json | workflow_core_runner`; `workflow_core_runner` reserved for exactly this runner.
- **Structured ingest** (PR #10) and **C4 ledger hardening** (PR #8) already in.

**Net:** every substrate-independent Core hardening the design said must precede the runner is done. There is
**no remaining Core-provenance prerequisite**. The next unit is **Phase 2b — the runner prototype itself** —
and the gating risk is no longer Core; it is **three unverified Claude Code platform facts** (§ smallest first
ticket).

---

## 1. Runner boundary — what each layer owns

The `forge-core-runner` is **not** a logic owner; it is the **narrow-tool bridge** that lets the
fs/shell-less workflow script reach Core + read git. Logic stays in Core; sequencing stays in the script.

| Responsibility | Owner | Notes |
|---|---|---|
| Contract validate / dry-run / packets / active-ticket (gate-bearing) / guard paths / parse-agent / agent-schema / **dispatch pm (decision-id assign)** / **ledger append** / run-report write | **Forge Core** (deterministic) | All shipped. The trust root. Every one is a `forge <cmd>` call. |
| Run a `forge <cmd>` + **read-only** git, return `{exit, stdout}`; persist agent outputs to `.forge/**` | **forge-core-runner agent** | The only agent touching Core; the only writer (`.forge/` only). Narrowest tool grant. |
| Phase ordering, correction loop (cap 3), parallel verifiers, capturing structured returns into variables, assembling the handoff, preflight+lock | **Workflow script** (deterministic JS) | No fs/shell of its own; no outward stage. |
| Approve at launch; review the run-report; perform **all** outward actions (commit/push/PR/merge) | **Human** | Unchanged gate. |

**Boundary clarity:** the workflow *triggers* sequences; Core *decides* (gate, decision-id, validation,
attestation); the human *acts* outward. No new Core primitive is strictly required for a prototype — the runner
is an assembly of the **existing** Core CLI + a new agent-type + a deny ruleset + a saved script.

## 2. Workflow script surface — where it lives (⚠ concrete finding)

The design assumes a **checked-in, reviewed** `.claude/workflows/forge-run-ticket.workflow.js` so "no outward
stage" is statically auditable (prevention control #2). **But `.gitignore:9` ignores `.claude/`** — a workflow
saved there is **untracked**, defeating the "reviewed artifact" property. **Decision needed:** either (a) a
**tracked** location (e.g. a new tracked `workflows/` dir, or un-ignore a specific `.claude/workflows/` path),
or (b) ship it with the package under a tracked path for adopters. **Recommendation:** a tracked
`workflows/forge-run-ticket.workflow.js` for the prototype (auditable + reviewable in PR), with `verify-install`
scope deferred (Open Q #6). `commands/forge-run-ticket.md` stays the maintained Markdown fallback — **no new
`docs/workflows/`**.

## 3. Capture model — the structural cure (biggest operational win)

The recurring capture failure (fabricated/pre-written/batched YAML — [[b1-fabricated-agent-output-incident]])
is an operator-discipline failure of the Markdown path. The runner **structurally eliminates** it:

```
agent({agentType, schema}) → validated object returned INTO a script variable
   → forge-core-runner writes it verbatim to .forge/<role>-output.json
   → forge-core-runner runs `forge parse-agent <role> --json-file …` (Core authoritative re-validate)
   → ok:false → ESCALATE
```

No hand-written YAML, no composed replacement, no batching — **because the script has no fs/shell and the
capture is the agent's typed return value, not an operator copy-paste.** This is the single biggest reason to
build the runner: it converts a lock-tested *discipline* into a *structural* guarantee. This is exactly where
`agent_output_source: workflow_core_runner` is emitted.

## 4. `agent_output_source` usage (1c field)

- `yaml_text` — Markdown fallback path (operator-captured YAML).
- `structured_json` — structured `agent({schema})` capture, but **not** owned by the deterministic runner
  (e.g. a future hybrid).
- `workflow_core_runner` — emitted **only** when the forge-core-runner owns deterministic capture+persist, i.e.
  the runner path. Per Dan's 1c ratification: emit it only when the runner actually owns the capture. In the
  runner this is the normal case → the runner passes `--agent-output-source-<role> workflow_core_runner` to
  `run-report write`.

## 5. Structured-output path — direct schema, not raw text

**Recommendation: structured output directly.** `forge-core-runner` runs `forge agent-schema <role>`
(`schemas.ts:115` `toRoleJsonSchema`) → script calls `agent(prompt, {agentType, schema})` → Core re-validates
via `parse-agent --json-file`. The JSON-Schema layer enforces shape/enums/`additionalProperties:false`; **Core
Zod is authoritative** (the only enforcer of `.superRefine`, `^D-\d+$`, `NonEmpty`, `.strict()` —
`schemas.ts:83-91`). Raw-text + ingest is the fallback only. This eliminates the YAML-formatting failure class
the charters spend paragraphs defending against. **The path is already built (PR #10); the runner consumes it.**

## 6. Permissions & hooks — where each control fits (classify only)

| Control needed | Where it fits | Note |
|---|---|---|
| No direct push to main / no merge / no PR / no commit | **`permissions.deny`** `Bash(git push:*)`, `Bash(gh:*)`, `Bash(git merge:*)`, `Bash(git commit:*)` | The v1 backstop. Deny overrides allow across scopes. **(UNVERIFIED** a workflow agent honors session deny — must spike.) |
| No forbidden-file edits | **Deterministic `guard paths` + scope-verifier** | deny is tool-name granularity → cannot fence *paths*; the guard is the real control (already shipped). |
| Shell-redirection hazard ([[run-report-shell-redirect-hazard]]) | **Absorbed by the runner design** | forge-core-runner builds **argv arrays**, not shell-composed flag strings → the `->`/parens hazard disappears on the runner path. The 1c follow-up is largely retired by 2b. |
| PowerShell-through-Bash bypass (tool-policy gap) | **PreToolUse hook** (only thing that can pattern-match the command *string* inside a Bash call) + narrow core-runner Bash grant | deny rules can't see inside a `Bash` subshell reliably → §7. |
| No execution outside repo_root | **§14 cwd discipline + `guard REPO_ROOT_MISMATCH`** | Already enforced; packets pin absolute repo_root. |

**Open Question #1 (the policy decision):** the strongest documented enforcement is a `PreToolUse` hook, but the
standing rule defers hooks. Design's lean (which I concur with): ship a **`permissions.deny` ruleset** as the v1
backstop (declarative, *not* a hook, within current policy); defer the hook to a defense-in-depth tier. **This
decision should wait for the spike** — fact #3 tells us whether deny even holds for workflow agents.

## 7. Tool-policy issue (PowerShell-through-Bash) — classification

**Classification: permissions/hook hardening + a spike test — NOT its own ticket yet.** A deny rule on
`powershell`/`pwsh` does nothing if an agent routes the same command through `Bash`. Only a `PreToolUse` hook
can pattern-match the actual command string. Recommendation: **fold the empirical test into the spike** (does a
workflow agent honor session `permissions.deny`, and can a `Bash` subshell route around a command-level deny?).
The spike result decides whether this needs (a) the deny ruleset + narrow core-runner grant is sufficient, or
(b) a dedicated PreToolUse-hook hardening ticket (which would also be the hooks-deferred reversal of Open Q #1).
It also intersects the v1 self-run cwd note: forge-core-runner's Bash grant must be the narrowest possible
(`node <forge>/dist/cli.js *` + read-only `git -C * rev-parse/status/diff/rev-list`).

## 8. Commit gate — unchanged, substrate-relocated

The runner returns the **Core-owned run-report** as its single answer: PASS + `commit_gate_materials`
(proposed status transition, suggested commit message, suggested commands), or ESCALATE + recovery brief. The
script contains **no** commit/push/PR/merge stage; the deny ruleset backstops it; the human performs every
outward action. `safety.*` / `final_branch_status.committed` stay `z.literal(false)` and attest no outward
action happened. Identical gate to today — only the substrate moves.

## 9. Backward compatibility

`/forge-run-ticket` (Markdown) stays a **maintained fallback — no sunset** (design §2d). The runner and the
Markdown command are **parallel paths over the same Core**, not wrapper/wrapped. Both call the identical Core
CLI; both produce the same `forge-run-report/v1`. Promote the runner to *preferred* only after one self-run +
one external safe-target pilot (2c) and the adversarial pass (2b).

## 10. Smallest first ticket — **the empirical spike** (recommended)

The design flagged three **research-preview / UNVERIFIED** runtime facts (Open Q #7) that gate the *entire*
architecture:

1. Workflow `agent({schema})` error/refusal/`max_tokens` behavior (→ does ESCALATE-on-error hold?).
2. Whether `agent()` accepts `agentType` and it resolves a **project subagent's tool grants** (→ does
   forge-core-runner's tool isolation actually work?).
3. Whether a workflow agent **honors session `permissions.deny`** (→ does the v1 prevention backstop exist at
   all? — and the PowerShell-through-Bash test of §7).

These are load-bearing for tool isolation **and** the security backstop **and** the hooks-vs-deny policy
decision. Per the standing rule (*"when a runtime fact isn't in official docs, run a throwaway gitignored spike
and verify empirically before designing on it"* — [[workflow-era-pivot]]), the **smallest safe first step is a
throwaway spike**, not runner code.

**Recommendation: a standalone, gitignored spike under `pilot-local/workflow-runner-spike/`** (like the Phase 0
structured-output spike), verifying facts 1–3 with the *real* Workflow tool + a throwaway agent-type + a
throwaway deny rule. It touches **no production code**, authors **no epic/contract**, and produces a
`FINDINGS.md`. I diverge slightly from the design ("fold the spike into the start of 2b"): I recommend the
spike be **its own first step** because its results determine (a) the runner architecture, (b) the deny-rule vs
hook policy (Open Q #1), and (c) whether the PowerShell-bypass needs a dedicated ticket — three decisions you
should not pre-commit before the evidence.

**Then** the first *governed* implementation ticket (Phase 2b skeleton) becomes well-defined:
`forge-core-runner` agent-type (tracked) + the `permissions.deny` ruleset + a saved no-outward-stage workflow
script proven to a commit-gate PASS on `sandbox-epic`, frozen-build.

### Why the spike is not a Forge-governed ticket
The spike is **research, not governed change** — gitignored, throwaway, no production edit. So `allowed_paths` /
`risk` / `change_class` / `gate` don't apply in the Forge-contract sense (mirroring the Phase 0 spike, which was
gitignored and never a ticket). **If you prefer a governed first ticket instead**, the smallest is the
forge-core-runner agent-type + deny ruleset (below) — but it would be building on the three unverified facts,
which is why I recommend the spike first.

---

## Scope sketch (for the first *governed* ticket, AFTER the spike)

Not for authoring now — provided so the shape is visible.

- **`allowed_paths` (candidate):** `workflows/forge-run-ticket.workflow.js` (tracked location TBD per §2),
  `.claude/agents/forge-core-runner.md` **or** `agents/forge-core-runner.md` (tracked charter), a project
  `permissions.deny` settings fragment, colocated spike-derived notes. **No `src/**` change expected** — the
  runner consumes existing Core.
- **`forbidden_paths` (candidate):** all of `src/**` (the runner is an assembly over existing Core — a prototype
  that needs a Core change is a signal to stop and re-scope), `commands/forge-run-ticket.md` (fallback stays
  intact), the existing four charters, `docs/governance/**`, `package.json`/lockfile, `tsconfig.json`.
- **risk / change_class / blast_radius / gate (candidate):** `risk: high` (new substrate, security-critical
  agent-type + deny backstop), `change_class: feature`, `blast_radius: repo` (new execution path), `gate: pr`
  + an **adversarial pass** before promotion. Avoid escalation keywords in prose; confirm via dry-run.

---

## Required output — summary

- **Current state:** `c2a22c8`, all Core prerequisites (B1/B2/1c/C4/structured-ingest) **shipped**; runner
  foundation complete; gating risk is platform facts, not Core.
- **Recommended architecture:** workflow script (sequencing, no fs/shell, no outward stage) → forge-core-runner
  (narrow bridge to Core + read-only git, writes `.forge/`) → existing Core CLI (trust root) → Core run-report
  → human performs outward actions. Unchanged from the accepted design; now unblocked.
- **Core owns:** validate/dry-run/packets/active-ticket(gate)/guard/parse-agent/agent-schema/dispatch-pm(decision-id)/ledger-append/run-report — all shipped.
- **Workflow owns:** ordering, correction loop, parallel verifiers, variable capture, handoff assembly, preflight/lock.
- **Human owns:** launch approval + all outward actions.
- **Capture model:** typed `agent({schema})` return → core-runner persists `.json` → Core `parse-agent` re-validate. Structural cure for the capture failure.
- **agent_output_source:** `workflow_core_runner` on the runner path; `yaml_text` fallback; `structured_json` hybrid.
- **Structured output:** direct `agent({agentType, schema})` from `forge agent-schema`; Core Zod authoritative; YAML fallback.
- **Hook/permission fit:** `permissions.deny` = v1 outward backstop; guard = path fence; hook = command-string matcher (PowerShell bypass) — deferred; cwd discipline = repo-root fence.
- **Tool-policy risk:** PowerShell-through-Bash → permissions/hook hardening + spike test; not its own ticket yet.
- **Smallest first ticket:** **a throwaway gitignored spike** verifying the 3 platform facts (not runner code, not an epic).
- **Risk/scope of the eventual governed ticket:** `high` / `feature` / `repo` / `pr` + adversarial pass; assembly over existing Core, `src/**` forbidden.

---

## Open decisions for Dan

1. **Spike-first vs fold-into-2b.** Approve a standalone gitignored spike (verify the 3 platform facts) as the
   next step, before any runner code or epic? (My strong lean: **yes, spike first** — the facts gate the
   architecture, the deny/hook policy, and the PowerShell-bypass classification.)
2. **Outward backstop policy (the big one).** `permissions.deny` ruleset as the v1 backstop (declarative, not a
   hook, within current policy) with the `PreToolUse` hook deferred — **or** reverse the hooks-deferred rule
   now? (My lean: deny-ruleset v1, decide after the spike confirms deny holds.)
3. **Tracked workflow location.** `.claude/` is gitignored, defeating the "reviewed artifact" property. Use a
   tracked `workflows/` dir (my lean), un-ignore a `.claude/workflows/` path, or ship-with-package?
4. **Governed-ticket preference.** If you'd rather the first step be a *governed* Forge ticket than a research
   spike, the smallest is the forge-core-runner agent-type + deny ruleset + no-op workflow — but it builds on
   unverified facts. Spike-first or governed-first?
5. **PowerShell-bypass handling.** Fold its test into the spike and let the result decide (my lean), or open a
   separate security-process ticket now?

---

## Hard constraints (preserved — none weakened by this discovery)

Human-gated commit/merge · path fences · `parse-agent` validation · Core-pinned gate · Core-pinned decision_id
· Core-owned ledger append · literal-false safety model · `forge-run-report/v1` guarantees. The runner
*relocates the substrate*; it does not touch any of these — every consequential boundary remains a Core CLI
call, and the run-report's `z.literal(false)` attestation is unchanged.

## Recommendation

**Do not author an epic yet.** Approve a **standalone, gitignored empirical spike** (`pilot-local/
workflow-runner-spike/`) verifying the three platform facts as the next step. It is the smallest safe move, it
de-risks the entire runner architecture and the deny/hook policy decision, and it touches no production code.
Once the spike's `FINDINGS.md` lands, the first governed Phase 2b ticket (forge-core-runner agent-type + deny
ruleset + saved workflow) becomes precisely scopeable. Hold all runner implementation until Dan ratifies the
§Open-decisions — chiefly spike-first and the outward-backstop policy.
