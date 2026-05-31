# Workflow-Backed Runner Skeleton — Contract Discovery

> Discovery doc for the first governed Phase 2b ticket `forge-workflow-runner-skeleton`. Author: senior
> engineer, 2026-05-31. Status: **for PM review — no epic, no branch, no implementation.** Builds on
> `docs/workflow-backed-runner-phase2-design.md`, `docs/workflow-backed-runner-discovery.md`, and the
> 2026-05-31 spike (`pilot-local/workflow-runner-spike/FINDINGS.md`, gitignored — durable facts mirrored in §0
> here and in memory `workflow-runner-spike-facts`). Evidence cited by `path:line`.

## 0. Spike facts this skeleton relies on (preserved here — spike dir is gitignored)

- **Workflow `agent({schema})` returns a typed object**, enforcing structure not semantics → **Core
  re-validation stays authoritative**; ESCALATE is driven by Core, not a structured-output exception.
- **`agentType` resolves and honors tool-name grants** (a bogus type throws; the four `forge-*` charters are
  registered). A narrow-grant `forge-core-runner` will be honored.
- **Workflow agents honor `permissions.deny`**, command-specific, and the **PowerShell-through-Bash bypass was
  blocked**; a mid-session deny applied to a freshly-spawned agent. → **`permissions.deny` is an adequate v1
  outward-action backstop; hooks stay deferred.**

## 1. Current repo state

`main @ 2b3f42d` · 535 tests / 37 files · typecheck/build PASS · verify-install OK · tree clean. Discovery doc
PR #21 landed. The runner's Core prerequisites (B1/B2/1c/C4/structured-ingest) are all shipped.

## 2. The central scope question — **does the skeleton need any `src/**` change? NO.**

The one plausible gap was `forge dispatch pm`, which reads agent-output files via `fs.readFileSync` →
`parseAgentOutput` (the **YAML** path, `run.ts:201-204` → `dispatch.ts:267-274`), **not** the structured ingest
adapter. **Empirically verified:** a pure-JSON `.forge/<role>-output.json` parses `ok:true` through **both**
`forge parse-agent <role> --file` (YAML path) and `--json-file` (structured path) — because JSON ⊂ YAML and the
`yaml` parser accepts it. So the workflow can persist structured outputs as `.json` and feed the **same files**
to `forge dispatch pm` unchanged.

**⇒ The skeleton is pure assembly over existing Core. `src/**` is forbidden.** Every consequential boundary is
an existing `forge` CLI call: `validate`, `run --dry-run`, `packets`, `active-ticket`, `agent-schema`,
`dispatch engineer/pm`, `guard paths`, `parse-agent --json-file`, `ledger append`, `run-report write`
(incl. `--agent-output-source-* workflow_core_runner`, shipped in 1c). **No tiny Core adapter is required.**

---

## Discovery answers

### Q1 — Agent type location

**`agents/forge-core-runner.md`** (tracked), installed to `~/.claude/agents/` by `pnpm install-commands`
(`scripts/install-commands.mjs:29-30` installs `agents/*.md`). The four existing `forge-*` charters live there
and the spike confirmed they register as resolvable agent types. So the new charter is reviewable (tracked) and
becomes available to `agent({agentType:'forge-core-runner'})` after an install refresh. **`verify-install` will
report stale until `pnpm install-commands` re-runs** (the known capture-protocol-hardening pattern). Do **not**
author it only under gitignored `.claude/agents/`.

### Q2 — Workflow location

**Tracked `workflows/forge-run-ticket.workflow.js`** (new top-level dir). Rationale: `.claude/workflows/` is
gitignored (`.gitignore:10` ignores `.claude/`), so a script there is not a reviewable artifact —
defeating prevention-control #2 ("no outward stage is statically auditable"). For the **prototype proof**, run
it via `Workflow({scriptPath: "workflows/forge-run-ticket.workflow.js"})` (no `.claude/` install needed). A
later install/sync step into `.claude/workflows/` (if Claude Code requires it for name-resolution) is a
separate, deferred distribution concern — the **reviewed source stays tracked**.

### Q3 — Permissions (deny) location — ⚠ the real open problem

**There is no tracked `.claude/settings.json`** (confirmed) and `.claude/` is gitignored, so the deny ruleset
**has no tracked home today** and `install-commands` does not install settings. Options:
- **(A)** Add a `.gitignore` exception (`!.claude/settings.json`) and track `.claude/settings.json` with the
  deny block — makes it a reviewed, auto-applied project artifact. Smallest path to a *real, tracked, enforced*
  backstop. Touches `.gitignore` (sensitive — surface).
- **(B)** Ship the deny rules as a **tracked reference fragment** (e.g. `workflows/forge-runner.permissions.json`
  + adoption note) that the operator/adopter copies into their settings — reviewable but **not auto-enforced**
  (weaker; relies on manual application).
- **(C)** For the **prototype proof only**, apply the deny via the gitignored `.claude/settings.local.json`
  (where the spike proved it works) and track the *reviewed* ruleset via (A) or (B).

**Recommendation:** **(A)** — track `.claude/settings.json` via a `.gitignore` exception so the v1 backstop is a
real, reviewed, enforced artifact (don't rely on local-only settings for product behavior, per Dan). This is the
single most important open decision for the skeleton.

### Q4 — Smallest skeleton behavior

The minimal end-to-end proof that *workflow executes → Core governs → human approves*, all Core/git via
`forge-core-runner`, agent emission via `agent({agentType, schema})`, **no outward stage**:

1. **Preflight** (core-runner): `forge validate` + `run --dry-run` + read-only `git status --porcelain` + lock-absence check.
2. **Packets + gate** (core-runner): `forge packets` → script captures `active_run.gate`.
3. **Lock + active-ticket** (core-runner): write `.forge/lock.json`; `forge active-ticket --json` → `.forge/active-ticket.json` (gate-bearing, B1).
4. **Branch:** prepared by the **human/launcher before launch** (keeps core-runner read-only-git; branch creation is the one git-write the runner deliberately does not own). The skeleton runs on the prepared branch.
5. **Engineer:** `forge dispatch engineer` (prompt) + `forge agent-schema engineer` (schema) → `agent(prompt, {agentType:'forge-engineer', schema})` → core-runner persists `.forge/engineer-output.json` → `forge parse-agent engineer --json-file`.
6. **Independent verify** (core-runner): run the target's `verify_commands`.
7. **Guard** (core-runner): `forge guard paths --active …`.
8. **Verifiers:** semantic then scope, same structured-capture pattern → `parse-agent --json-file`.
9. **PM:** read ledger; `forge dispatch pm --engineer-output .forge/engineer-output.json … --assigned-decision-id` (JSON-as-YAML, verified) → `agent({agentType:'forge-pm', schema})` → persist `.json` → `parse-agent pm --json-file --expected-decision-id` → `forge ledger append`.
10. **Run-report** (core-runner): `forge run-report write … --agent-output-source-engineer workflow_core_runner …` (per role).
11. **Handoff:** the script returns the run-report path + commit-gate materials. **No commit/push/PR/merge stage.** Human performs the outward action.

**Challenge to scope (offered):** an even smaller *mechanism-only* skeleton could prove core-runner↔Core
round-trips + one structured capture + `parse-agent --json-file` + `run-report write` **without** a full green
loop (e.g. stop at an ESCALATE/dry handoff). **Recommendation:** do the **full loop on `sandbox-epic`** — it is
the honest proof of the commit-gate handoff and `sandbox-epic` is a sterile fixture, so the marginal cost over a
mechanism-only skeleton is small and the evidence is far stronger.

### Q5 — Sandbox target

**`sandbox-epic`** (tracked sterile fixture; `sandbox-epic/sprint-01-sandbox/tickets/T01-add-helper.md`). Do
**not** run the skeleton against any live epic until proven. The standing promotion bar (one self-run + one
external safe target) applies only at Phase 2c/2d, not the skeleton.

### Q6 — `agent_output_source` behavior

Emit **`workflow_core_runner`** for each role **only because, on the runner path, `forge-core-runner` owns the
deterministic capture+persist** of the structured output to `.forge/<role>-output.json` and the Core
re-validation. That is exactly the condition Dan set in 1c. (Markdown fallback continues to emit nothing /
`yaml_text`.) The skeleton passes `--agent-output-source-<role> workflow_core_runner` to `run-report write`.

### Q7 — Exact v1 deny rules

Spike-validated mechanism; recommended v1 set:
```
"Bash(git push:*)"        "Bash(git commit:*)"     "Bash(git merge:*)"
"Bash(gh pr create:*)"    "Bash(gh pr merge:*)"    "Bash(gh pr close:*)"
"Bash(gh:*)"              "Bash(powershell:*)"     "Bash(pwsh:*)"
```
Plus consider `"Bash(git reset --hard:*)"`, `"Bash(git push --force:*)"` (redundant under `git push:*` but
explicit). **Shell-redirect / repo-root hazards:** the runner builds **argv arrays, not shell-composed flag
strings**, so the 1c `->`-redirect hazard does not arise on this path (the core-runner runs `forge` with
discrete args). repo-root execution is fenced by the §14 cwd discipline + `guard REPO_ROOT_MISMATCH`. Deny is
command-prefix granular, so keep core-runner's Bash grant narrow (`node <forge>/dist/cli.js *` + read-only
`git -C * rev-parse/status/diff/rev-list`) as the first line, with deny as the backstop.

### Q8 — Tests / verification

This is a substrate ticket with **no `src/**` change → no new unit tests** (Core is already tested). Honest
verification plan:
- **Manual spike-style proof:** run `workflows/forge-run-ticket.workflow.js` against `sandbox-epic` to a
  commit-gate PASS; inspect the produced `run-report.json`: `result:PASS`, `safety.*` all `false`,
  `final_branch_status.committed:false`, `agent_output_source.* = workflow_core_runner`, `decision_id D-001`,
  both verifiers APPROVE, guard OK.
- **`pnpm test` / `pnpm typecheck` stay green** (they will — no src change) as the regression guard.
- **`verify-install`** after `pnpm install-commands` (installs the new `forge-core-runner.md`) → 10/10 current.
- **Deny proof:** with the v1 deny active, confirm a core-runner attempt at an outward sentinel is BLOCKED
  (already spike-evidenced; re-confirm under the shipped ruleset).
- **Open tension (surface):** ForgeGate's ethos is TDD/tested; a workflow script + charter + deny rules have
  weak automated coverage by nature. If Dan wants automated coverage, a narrow **charter lock-test** for
  `forge-core-runner` (mirroring `src/agents/charter-output-format.test.ts` / the protocol-lock test) would
  require relaxing the `src/**` fence for **one** test file. **Recommendation:** defer — rely on the proof-run +
  the existing Core test suite for the skeleton; add a lock-test in a follow-up if the charter stabilizes.

### Q9 — Rollback / fallback

- `commands/forge-run-ticket.md` **remains the maintained fallback** (forbidden path in this ticket — untouched).
- The workflow runner is **not default**; it is a prototype proven on `sandbox-epic` only.
- **No sunset** of the Markdown path. Both paths drive the same Core.

---

## Scope proposal (for the eventual contract — not authored yet)

**`allowed_paths` (candidate):**
```
workflows/forge-run-ticket.workflow.js
agents/forge-core-runner.md
docs/workflow-backed-runner-skeleton-discovery.md   # rides with the contract
docs/epics/forge-workflow-runner-skeleton/**
```
**Conditionally allowed (pending Q3 decision):** `.gitignore` (add `!.claude/settings.json`) **and**
`.claude/settings.json` (the tracked deny ruleset) — **only if** Dan picks option (A). Touching `.gitignore` /
`.claude/**` is sensitive and must be an explicit decision, not assumed.

**`forbidden_paths` (candidate):**
```
src/**                              commands/forge-run-ticket.md
agents/forge-engineer.md            agents/forge-semantic-verifier.md
agents/forge-scope-verifier.md      agents/forge-pm.md
docs/governance/**                  package.json   pnpm-lock.yaml
tsconfig.json   vitest.config.ts    README.md      .github/**
```
(If Q3 = option B, also forbid `.claude/**` and `.gitignore`.)

**risk / change_class / blast_radius / gate:** `risk: high` (new execution substrate + security-critical
agent-type + outward-action backstop), `change_class: feature`, `blast_radius: repo` (introduces a new run
path), `gate: pr` **+ a standing adversarial pass** before any promotion. Prose must avoid the negation-blind
escalation keywords; confirm `gate: pr, no escalation` via `forge run --dry-run` at contract time.

---

## Required output — summary

- **Repo state:** `2b3f42d`, prerequisites shipped, tree clean.
- **Skeleton architecture:** tracked workflow script → `forge-core-runner` (narrow grant) → existing Core CLI →
  Core run-report → human outward action. **No `src/**` change** (verified).
- **Workflow location:** tracked `workflows/forge-run-ticket.workflow.js`.
- **Agent-type location:** tracked `agents/forge-core-runner.md`, installed via `install-commands`.
- **Permissions location:** ⚠ no tracked home today → recommend tracking `.claude/settings.json` via a
  `.gitignore` exception (option A) — **the key open decision**.
- **Smallest behavior:** full one-ticket loop on `sandbox-epic`, structured capture via core-runner, run-report
  PASS, no outward stage (mechanism-only is the smaller alternative if Dan prefers two steps).
- **Sandbox target:** `sandbox-epic`.
- **agent_output_source:** `workflow_core_runner` (core-runner owns capture+persist).
- **Deny rules:** the 9-rule set above; argv-array calls retire the shell-redirect hazard.
- **allowed/forbidden:** as proposed (settings/gitignore conditional on Q3).
- **risk/class/blast/gate:** high / feature / repo / pr + adversarial pass.
- **Verification:** proof-run on sandbox + green `pnpm test`/`typecheck` + verify-install; charter lock-test
  deferred (would need a narrow src exception).

## Open decisions for Dan

1. **Deny-ruleset tracked home (the big one).** Option A (track `.claude/settings.json` via `.gitignore`
   exception — real enforced backstop, touches `.gitignore`/`.claude/`), B (tracked reference fragment, manual
   apply, not auto-enforced), or C (local-only for the proof + tracked reference)? My lean: **A**.
2. **Skeleton size.** Full green loop on `sandbox-epic` (my lean) vs a smaller mechanism-only dry skeleton?
3. **Branch creation.** Confirm the human/launcher prepares the branch before launch (keeps core-runner
   read-only-git), vs granting the runner a branch-create capability?
4. **Automated coverage.** Accept proof-run-only verification for the skeleton (my lean), or relax `src/**` for
   one `forge-core-runner` charter lock-test?
5. **Authoring path.** Author/run this skeleton ticket through the **Markdown `/forge-run-ticket`** (it creates
   the artifacts; the workflow proof-run is separate acceptance evidence), or hand-author the artifacts under a
   docs/contract PR? (The skeleton's artifacts aren't exercised by `pnpm test`, so the Markdown run only proves
   the tree compiles — the real proof is the manual workflow run.)

## Hard constraints (none weakened)

Human-gated commit/merge · path fences · `parse-agent` validation · Core-pinned gate · Core-pinned decision_id ·
Core-owned ledger append · literal-false safety model · `forge-run-report/v1` guarantees. The skeleton is
assembly over existing Core; it adds an execution substrate and an enforced deny backstop, and touches no Core
logic.

## Recommendation

**Do not author the epic yet.** Ratify the §Open-decisions — chiefly the **deny-ruleset tracked home** (option
A: track `.claude/settings.json` via a `.gitignore` exception) and the **skeleton size** (full loop on
`sandbox-epic`). Once ratified, the contract is small and `src/**`-free: a tracked workflow script, a
`forge-core-runner` charter, the deny ruleset, proven by a manual workflow run on `sandbox-epic` to a
commit-gate PASS. I recommend landing this discovery doc with the eventual contract (or as a standalone docs PR)
so the reasoning trail is tracked, and **not** committing the gitignored spike `FINDINGS.md` (its durable facts
are already in this doc and in memory).
