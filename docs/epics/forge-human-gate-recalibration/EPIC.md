# Epic — Human-gate re-calibration

## Why this epic exists

The four-class permissions hook (`.claude/hooks/forge-permissions.mjs`) drifted off the risk axis. It already
ALLOWS the *more* outward actions — `git push -u origin <feature>` and `gh pr create` (Class 3) — while it DENIES the
*less* outward ones — branch creation and `git commit` (Class 4), which are local and trivially reversible. So the
agent must hand a human the keystrokes for safe, reversible mechanics on every governed run, even though it is trusted
to publish the branch and open the PR right after. That is a bad friction-to-risk ratio.

The fix is to re-anchor the gate on what actually matters — **reversibility and blast radius** — not on command shape.
Full reasoning + Sr-PM ratification: `.forge/human-gate-recalibration-design-packet.md` (gitignored).

## The three-tier model (ratified)

- **Tier 1 — mechanical, reversible, no decision encoded → agent does it (`allow`).** Safe feature-branch creation;
  explicit-path staging (already Class-2 ALLOW).
- **Tier 2 — decision-bearing but reversible → native per-action approval (`ask`).** `git commit` of explicitly-staged
  work. The run still stops at the commit gate and shows the diff/run-report; the human approves once; ForgeGate then
  executes the commit. **Gated on a discovery spike** that proves the harness honors `permissionDecision: "ask"`.
- **Tier 3 — irreversible / outward-to-shared / destructive → human-gated (`deny` → `!`).** Merge, force-push,
  `reset --hard`, `clean`, default-branch mutation, branch-deletion, history rewrite, `gh api` mutation. **Unchanged.**

The product promise evolves from *"the human types the dangerous commands"* to *"the human approves consequential
decisions; ForgeGate handles safe mechanics."*

## Ticket sequence

- **T01 (this sprint) — Tier 1: allow safe feature-branch creation.** The single lowest-risk shape: extend the hook's
  `switch` classifier to ALLOW `git switch -c <safe-feature-branch>` (the existing safe-feature-branch shape filter;
  never a protected/default branch, never `-C`/force/detach/extra flags/extra positionals). Additive ALLOW only — the
  deny engine, the Tier-3 destructive set, and the runner L3 backstop are provably untouched.

## Out of scope (this epic / deferred to later units, separate gos)

- **The `ask` discovery spike** (proves the Tier-2 mechanism) and the **commit-ASK** change itself.
- The **posture flag** that could later move feature-push / `gh pr create` from ALLOW to ASK for a stricter enterprise
  mode (design for it; do not build it).
- `commit --amend`, branch-deletion, and the rest of the Tier-3 set — they **stay DENY**.
- The README permissions-section wording update (separate docs follow-up once Tier 1 lands).
- Any change to `.claude/settings.json` wiring, the deny engine, or the runner L3 policy.

## Implementation hazard (read before the T01 self-run)

`.claude/hooks/forge-permissions.mjs` is the **live** hook governing the session. Editing it changes behavior for the
**next** Bash git command in-session — the permissions epic's one prior showstopper. The implementation must therefore
be verified through the pure `decide()` self-check (`.claude/hooks/forge-permissions.selfcheck.mjs`), not by trusting
the live session mid-edit, and must be strictly **additive** (only the `switch -c` allow-shape), with the deny engine
and every existing Class-1/2/3/4 case left intact.

## Process note

Authored in the schema-required nested layout (`sprint-01-tier1-branch-create/…`) so `forge validate` passes — the
validator discovers sprints from `sprint-NN-slug/` subfolders.
