# Claude Code Permissions Policy — Discovery

> Discovery doc. Author: senior engineer, 2026-06-01. Status: **for PM review — no `.claude/settings.json` edit,
> no contract yet, no code.** Produced after PR #24 shipped the v1 deny-block backstop and a mid-session
> working-tree relaxation accidentally gutted the committed artifact (caught at the merge gate, `git restore`d
> before merge). Goal of this discovery: decide how ForgeGate's Claude Code permissions policy should let an
> engineer use the normal GitHub PR workflow while destructive operations stay blocked — **and** how to keep the
> runner's substrate-prevent backstop intact. Land via the PR-safe docs flow; the policy itself changes only
> through a reviewed contract, never a casual edit.

## 1. Why this is a real problem (not just a convenience tweak)

PR #24 shipped `.claude/settings.json` with an 11-rule `permissions.deny` block — the v1 **substrate backstop**
that prevents agents from performing outward actions (`git push/commit/merge`, all `gh`, and the
PowerShell-through-Bash bypass). That block did its job all session: every outward action (commit, push,
`gh pr create`, merge) was correctly **denied to the agent** and run by the human via `!`. That is the thesis
working — *workflow executes, Core governs, human approves outward action.*

But the **same file** governs two different actors:
1. **The runner's agents** (`forge-core-runner` and the role agents) during a governed ticket run — these MUST
   NOT act outward. The deny block is their command-level fence.
2. **The development agent** (Claude Code working *on* the ForgeGate repo itself) doing ordinary maintenance —
   push a feature branch, open a PR, check CI.

Today both are blocked identically. The incident happened precisely because someone tried to unblock actor (2)
by editing the file that protects actor (1) — and that file is *also the committed product artifact*. Three
concerns are conflated in one file: **product safety policy**, **runner backstop**, and **operator convenience**.

## 2. The hard constraint: `deny` outranks `allow` (verified)

In Claude Code, **`deny` rules take precedence over `allow` rules across every settings layer** (project
`.claude/settings.json`, local `.claude/settings.local.json`, user-level settings). Verified empirically this
session: `settings.local.json` already contained `allow: Bash(gh pr *)`, yet `gh` stayed blocked while
`settings.json` denied `Bash(gh:*)` — the local allow could not override the project deny.

**Consequence:** you cannot layer operator convenience *on top of* the shipped deny. As long as the committed
`.claude/settings.json` denies `Bash(gh:*)` / `Bash(git push:*)`, no local file can grant them back. Convenience
must therefore come from **changing the shipped deny itself** (a product-policy change) or from a **more
granular mechanism than allow/deny** (hooks). This is the crux every option below has to answer.

## 3. The runner backstop is multi-layer (don't collapse it)

The runner's "no outward action" guarantee rests on three independent layers — only the third is project-wide:

| Layer | Mechanism | Scope | Strength |
|---|---|---|---|
| L1 | The workflow script has **no commit/push/PR/merge stage** | runner code | strong (audited; review-confirmed) |
| L2 | The `forge-core-runner` **charter** forbids outward actions; grants only Forge CLI + read-only git + `.forge/**` | runner agent | weak *alone* — a tool-name grant can't restrict *which* command Bash runs (spike finding) |
| L3 | `.claude/settings.json` **`permissions.deny`** | whole project/session | strong, but blanket — also blocks the dev agent |

The spike (`workflow-runner-spike-facts`) established that **L3 is the real fence** precisely because L2 (tool
grants) can't restrict commands. So **narrowing L3 weakens the runner backstop** unless something compensates.
Any option that relaxes the project deny must say explicitly what now prevents a runner agent from pushing.

## 4. Target policy (from the PM)

```
Allow (agent, normal PR workflow):       Deny (always):
- push a FEATURE branch                  - git push --force (history rewrite)
- gh pr create                           - git reset --hard
- gh pr view                             - bypass shells / policy-escape routes (powershell/pwsh-through-Bash)
- gh pr checks                           - destructive / irreversible ops
- gh pr merge ONLY after explicit human approval
```

Note the asymmetry: **push-feature-branch and open-PR are reversible/reviewable** (a branch can be deleted, a PR
closed), whereas **merge and force-push are not**. That asymmetry is the design seam — the policy should gate on
*reversibility*, not on "is it git/gh."

## 5. Options

**Option A — Narrow the shipped project deny to destructive-only.**
Deny just `git push --force`, `git reset --hard`, and the bypass shells; allow the rest.
- ✅ Simple; one-file change; immediately gives the dev agent normal PR workflow.
- ❌ Drops L3 for non-destructive outward actions, so the **runner's** agents could `git push` / `gh pr create`
  during a run — backstop falls to L1 (no-outward-stage) + L2 (charter, weak alone). Acceptable ONLY if L1 is
  proven exhaustive and we accept L2 as the agent-level guard. Also can't express "merge only after approval"
  (allow/deny is binary — it can't require a human ack).

**Option B — PreToolUse hooks (un-defer hooks).**
A hook inspects each Bash/`gh` call and decides allow/deny/ask with full context.
- ✅ Granular and context-aware: allow `gh pr create/view/checks`, **`ask` (prompt the human) for `gh pr
  merge`**, deny force-push/hard-reset, and — crucially — can deny outward actions *when the caller is a runner
  agent* while allowing them for the dev session. This is the only option that cleanly serves BOTH actors and
  expresses "merge needs approval."
- ❌ More to build/test; hooks were explicitly deferred in v1; a buggy hook is itself a safety surface. Needs
  its own small contract + tests.

**Option C — Separate the shipped adopter policy from ForgeGate's own repo policy.**
Ship the strict deny as an installable *template* (what adopters get), and let ForgeGate's own
`.claude/settings.json` be a different, dev-appropriate policy.
- ✅ Cleanly separates "product safety policy for adopters" from "how we develop ForgeGate."
- ❌ Doesn't by itself solve the runner backstop *inside the ForgeGate repo* (the runner is dogfooded here); and
  it forks two policies that can drift. Probably a *complement* to A or B, not a standalone answer.

**Option D — Status quo: keep strict; dev outward actions stay human-`!`.**
- ✅ Zero risk; backstop fully intact; the human runs ~3 commands per ticket (push, PR, merge).
- ❌ The friction the PM flagged; doesn't scale across many tickets/projects.

## 6. Recommendation (for the contract to ratify)

A **layered answer**, not a single edit:
1. **Keep the runner backstop strict and explicit.** Before relaxing anything project-wide, re-confirm L1 (the
   workflow has *no* outward-action path — already review-verified) and tighten L2 (the charter) so the runner's
   agents are guarded independent of L3. The runner must never depend on the project deny being broad.
2. **Adopt Option B (hooks) as the principled mechanism** for the dev/operator policy: allow `gh pr
   create/view/checks` and feature-branch push, **`ask` for `gh pr merge`**, deny `push --force` / `reset
   --hard` / bypass shells. Hooks are the only layer that can express "reversible → allow, irreversible →
   require approval, runner-agent → deny."
3. If hooks are too much for a first step, **Option A as an interim** — narrow the deny to destructive +
   bypass-shells — **only after** step 1 makes the runner's L1/L2 the real fence, and with `gh pr merge` kept
   human-only by convention until the hook lands.
4. Consider **Option C** for the *adopter*-facing template regardless, so what ships to other repos stays
   conservative.

Net: convenience for the dev agent should come from a **granular hook**, while the runner's "no outward action"
stays guaranteed by the runner's *own* layers — never by re-broadening or re-narrowing a single shared deny.

## 7. Claude Code Substrate Review

- **Workflows** = execution; **structured output** = agent-output; **agent-types** = role isolation + tool
  scope; **Forge Core** = governance/validation/provenance/gates. This ticket is about the **substrate
  permission layer** that sits under all of them.
- **`permissions.deny`** is a blunt, project-wide, binary fence — good as a backstop, poor at expressing intent
  ("reversible vs not", "who is calling"). **Hooks** are the Claude Code primitive designed for exactly that
  nuance; this is the first concrete case that justifies un-deferring them.
- **Skills ≠ safety.** Any convenience profile is operator tooling, not a governance control; the human gate and
  Core attestation remain the trust spine. Relaxing the agent's outward-action permissions must not be mistaken
  for relaxing the *product's* human-approves-outward-action thesis.

## 8. Risks

1. **Backstop erosion.** Narrowing the deny (Option A) silently weakens the runner unless L1/L2 are first made
   load-bearing. Mitigation: step 1 of the recommendation is mandatory and testable.
2. **Hook as a new safety surface.** A permissive or buggy hook is worse than a deny. Mitigation: small contract,
   tests, default-deny on hook error.
3. **`ask`-fatigue / auto-approve drift.** If "merge needs approval" degrades into reflexive yes, the gate is
   theater. Mitigation: keep merge human-only or `ask`-gated, never blanket-allow.
4. **Two-policy drift** (Option C). Mitigation: generate the adopter template from a single source.
5. **This repo dogfoods the runner**, so its own `.claude/settings.json` must satisfy *both* the dev convenience
   and the runner backstop simultaneously — the strongest reason to prefer hooks over a single shared deny.

## 9. Open questions for the PM

1. **Scope of the first ticket:** the principled Option B (hooks) — a slightly larger contract — or the interim
   Option A (narrow deny) now with hooks deferred again? (Recommendation: B, but A is a legitimate small step if
   step 1 is honored.)
2. **Is `git push` to a *feature* branch acceptable for the agent**, or should even push stay human-`!` and only
   `gh pr create/view/checks` be allowed? (i.e., where exactly is the reversible/irreversible line drawn?)
3. **Adopter template (Option C):** in scope now, or a separate follow-up? Should adopters ever get the relaxed
   profile, or only the strict deny?
4. **Runner L2 hardening:** do we want a contract item to make the `forge-core-runner` charter + a runner-scoped
   guard independently sufficient, so the runner never relies on the project deny breadth?

## 10. Proposed contract scope (next step, after PM picks a direction)

- In: the chosen mechanism (hook config and/or a revised, documented `.claude/settings.json`), tests that the
  allowed PR-workflow commands pass and the destructive/bypass commands are denied, and an explicit re-statement
  that the runner takes no outward action (L1) with the charter as L2.
- Out: any change to Forge Core (`src/**`); auto-merge; relaxing the *product/human-gate* thesis; broad `gh`
  allow without the merge-approval gate.
- Non-negotiable: `git push --force`, `git reset --hard`, and bypass shells stay denied; `gh pr merge` is never
  blanket-allowed to the agent.
