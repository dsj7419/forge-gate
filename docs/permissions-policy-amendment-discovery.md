# Permissions-Policy — Contract Amendment / Discovery (read-only-Git gap)

> Discovery / amendment note. Author: senior engineer, 2026-06-01. Status: **for PM review — no implementation,
> no settings/hook edit, no re-run.** Classification: **SHOULD_FIX_BEFORE_MERGE / contract amendment required.**
> The hook reached adversarial-GO and a PM PASS in isolation, but **activation in the real repo exposed a
> showstopper**: the deny-by-default-on-mention model blocks ordinary read-only/local Git, making the repo
> unusable. The safety mechanism worked — it caught a bad *design* before commit.

## 1. What happened
The proven hook was copied into the real repo for landing prep. A PreToolUse hook in `.claude/settings.json`
**re-loads on settings-change**, so the hook went live immediately and denied the orchestrator's very first
`git status` / `git diff`. Root cause: the policy permits ONLY the tiny PR allowlist (`git push -u origin
<branch>`, `gh pr create|view|checks`) and **denies everything else that mentions git/gh** — which includes the
essential, entirely-safe commands an agent uses constantly: `git status`, `git diff`, `git log`, `git show`,
`git add`, `git fetch`, `git pull`, `git switch`, `git checkout`, `git rev-parse`. The hook was de-activated by
removing its script + restoring the committed `settings.json`; the real repo is clean and unchanged.

## 2. Why the previous review missed it
The eight engineer iterations and ~7 adversarial review rounds verified **security** (no bypass reaches an
outward action) and the two **positive PR-workflow controls** — but **no check asserted that normal operational
Git still works**. The self-check and the verifiers had no "operational positive control" (e.g. `git status`
must ALLOW). Lesson: a permission-policy artifact must be proven NOT to break daily work, not only proven secure.

## 3. The model was too blunt
"Deny every git/gh mention unless it is the exact PR allow-shape" is correct for *security* but wrong for
*operations*: it treats `git status` the same as `git push --force`. Read-only/local Git carries no outward or
destructive risk and must be permitted.

## 4. Revised policy — four classes (the amendment)

**Class 1 — Safe local / read-only Git → PERMIT (or pass-through).** Carry no outward/destructive risk.
`git status`, `git diff`, `git log`, `git show`, `git rev-parse`, `git fetch`, `git branch` (list only),
`git switch <branch>`, `git checkout <branch>`, `git pull --ff-only`.
*Challenge each for destructive flags:* `git checkout -- <path>`/`git checkout .` (discards changes),
`git checkout -f`/`switch --force`/`--discard-changes`, `git clean`, `git branch -D`/`-M`, `git pull` without
`--ff-only` (can merge), `git fetch --prune` is fine but `--force` rewrites refs. Permit the **non-destructive
shapes**; deny the destructive flags.

**Class 2 — Safe staging Git → NARROWLY PERMIT (explicit paths only).** `git add <explicit-path>`.
**Deny** `git add .` / `-A` / `--all` / `:/` / `*` / broad pathspecs (can stage forbidden/generated/evidence
files). The hook allows explicit-path staging; Core `guard paths` + the scope verifier own path-fence
correctness (the hook is not the path authority). (Ratified §6.1.)

**Class 3 — Safe PR workflow → PERMIT.** `git push -u|--set-upstream origin <feature-branch>` (not the default
branch), `gh pr create`, `gh pr view`, `gh pr checks`.

**Class 4 — Destructive / approval-gated / unsafe → DENY.** direct push to `main`/`master`, `git push --force`/
`--force-with-lease`, `git reset --hard`, `git branch -D`/`-M`, destructive `checkout`/`switch` flags
(`-c`/`-C`/`-b`/`-B`/`--detach`/`--force`/`--discard-changes`/`checkout -- <path>`), **`git restore` /
`git checkout -- <path>` (human-only this ticket)**, `git clean`, `git merge`, `git rebase`, bare/`--rebase`/`--no-ff`
`git pull`, `gh pr merge` (human-only), `gh api` mutation, `powershell`/`pwsh` and shell-bypass, dynamic program
tokens, shell chaining/substitution/grouping around git/gh, and any **unknown git/gh shape**.

## 5. Architectural rule (the key change)
**Do not deny every git mention.** Instead:
1. If the command is **simple & static** (single command, no shell-control metacharacters, no dynamic/obfuscated
   program token) AND matches a **known safe shape** (Class 1/2/3) → **ALLOW**.
2. If the command is **simple & static** but **not** a known safe shape → **DENY** (e.g. an unrecognized or
   destructive git subcommand/flag).
3. If the command is **complex / dynamic / obfuscated** and involves or could hide git/gh → **DENY** (unchanged;
   this is the robust core that already holds — mention-scan + dynamic-program-token + complete non-`$`
   de-obfuscation + runner L3).
So the deny-side robustness we already proved stays; we **add positive safe shapes for Classes 1 & 2** to the
allowlist. Pass-through for genuinely non-git commands is unchanged.

## 6. Resolved decisions (PM-ratified 2026-06-01)
1. **`git add` scope:** permit **explicit-path** staging only — `git add <explicit-path>`. **Deny** broad staging:
   `git add .`, `git add -A`, `git add --all`, `git add :/`, `git add *`, and broad pathspecs. The hook does not
   own path-fence correctness — it allows explicit-path staging; Core `guard paths` / the scope verifier remain
   authoritative on path compliance.
2. **`git restore` / `git checkout -- <path>`:** **human-only for this ticket → DENY.** These are locally
   destructive cleanup operations; a separate, carefully-scoped policy can follow after this lands.
3. **`git pull`:** permit only `git pull --ff-only`. **Deny** bare `git pull`, `git pull --rebase`, `git pull --no-ff`.
4. **`git switch` / `git checkout`:** permit **simple branch navigation only** — `git switch <branch>` /
   `git checkout <branch>`. **Deny** anything that creates/overwrites/detaches/modifies files: `git switch -c`/`-C`,
   `git checkout -b`/`-B`, `--detach`, `git checkout -- <path>`, `git switch --discard-changes`, `--force`.
5. **Runner agents:** may use **read-only Git only if needed** for evidence gathering — `git status`, `git diff`,
   `git log`, `git show`, `git rev-parse`. **Deny** runner agents ALL mutating/outward actions: `git add`,
   `git push`, `git merge`, `git rebase`, `git reset`, `git restore`, `git checkout -- <path>`, branch mutation,
   `gh pr create`, `gh pr merge`, `gh api` mutation.

## 7. Required acceptance criteria (operational + security)
Add self-check / tests proving BOTH usability and security:
- **Operational ALLOW:** `git status`, `git diff`, `git log`, `git show`, `git rev-parse`, `git fetch`,
  `git pull --ff-only`, `git switch <branch>`, `git branch` (list), `git add <allowed-path>`.
- **PR-workflow ALLOW:** `git push -u origin <feature-branch>`, `gh pr create|view|checks`.
- **DENY:** direct push to main, `git push --force`, `git reset --hard`, `git branch -D`, `git switch -c`/`-C`,
  `git checkout -b`/`-B`/`--detach`/`-f`/`checkout -- <path>`, `git restore <path>`, `git clean -fd`, `git merge`,
  `git rebase`, `gh pr merge`, `gh api` mutation, bare/`--rebase`/`--no-ff` `git pull`, and ALL the
  obfuscation/dynamic/chaining/grouping forms already closed (regression).
- **Staging boundary:** `git add <explicit-path>` allowed; `git add .`/`-A`/`--all`/`:/`/`*` **denied**.
- **Pass-through:** non-git commands (`pnpm test`, `ls`, `node`) unaffected.
- **Runner agents:** a forge runner agent may run **read-only Git** (`status`/`diff`/`log`/`show`/`rev-parse`)
  for evidence; it is **denied** ALL staging/push/PR/merge/restore/checkout-write/reset/branch-mutation/`gh` by
  every spelling.
- **The artifact must NOT break a representative daily Git session** — the load-bearing operational AC.
- **The artifact must NOT break a representative daily Git session** — this is the new, load-bearing AC.

## 8. Recommendation
Amend the `forge-permissions-policy` T01 contract to the four-class model above (keep the proven deny-side
robustness; add the Class-1/2 safe-Git allowlist; keep `gh pr merge` human-only + sentinel deferred). **Do not
implement again until the amendment is approved.** The bulk of the hard security work (the deny side) is done and
re-usable; this is an additive allowlist + an operational-controls test suite, not a rewrite.
