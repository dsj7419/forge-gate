# ForgeGate installation & adoption — design / discovery

> **Status: DESIGN ONLY — not approved for implementation.** No code changes proposed here are to be made
> until this design is accepted. This pass deliberately does **not** add hooks, a plugin, or an installer.
> It answers "how do we install and operate ForgeGate cleanly?" across two lanes and proposes the smallest
> next build ticket.

_Authored 2026-05-26 (read-only discovery against `main` @ `b131709`). Evidence is cited as `file:line`._

> **Update — shipped since this design.** The §8 proposal has landed:
> - **PR #1 — `forge verify-install`.** The read-only install-currency command from §8 now exists
>   (`src/install/verify-install.ts`, `src/install/cli.ts`), comparing this checkout's `commands/`+`agents/`
>   against the installed `~/.claude` copies and reporting `current` / `stale` / `missing` (exit 0 / 1). Closes
>   **G1**.
> - **PR #2 — `install-commands` summary.** `scripts/install-commands.mjs` no longer prints the stale
>   "definitions only" note; it now prints a post-install summary that points at `node dist/cli.js verify-install`
>   and the re-run loop, and states the charters are dispatched live by `/forge-run-ticket`. Closes **G2**.
> - **Read-only-wrapper guidance gap (G3) addressed in docs.** `docs/adopting-forgegate-in-a-project.md` now
>   states that `/forge-validate`, `/forge-status`, and `/forge-run-dry-run` absolutize a relative epic against
>   `TARGET_REPO` (relative works for in-target epics; absolute is for external epics), replacing the old
>   "always pass absolute" guidance.
>
> Remaining gaps (G4 adoption-model is documented as A/B/C in the adoption guide; G5–G8) are unchanged. Hooks,
> `forge doctor`, `forge init-target`, and an installer/plugin remain unbuilt future work.

---

## Scope & guardrails (from the PM brief)

- **Lane 1 — Dan's local/global workforce** across all personal repos. **Priority.**
- **Lane 2 — public GitHub users** cloning ForgeGate fresh. Must stay accurate.
- **Lane 3 — future automation** (installer scripts, `forge doctor`, plugin, hooks). Evaluate, do **not** build.
- Do **not**: add hooks; add a plugin; add status write-back / journal / auto-commit / push / PR / merge /
  multi-ticket; change command, parser, or guard behavior; touch any target repo or Accrulith; start a new pilot.

---

## 1. Observed facts (what exists today)

### 1.1 CLI install surface

- `package.json` exposes the binary as `"bin": { "forge": "./dist/cli.js" }` and a single export `"."` →
  `./dist/index.js`. `"files": ["dist"]` — only `dist/` ships if published. Package is `forge-core`, **private:
  true**, version `0.0.1` (not published).
- Scripts: `build` (`tsc`), `typecheck`, `test` (`vitest run`), `forge` (`tsx src/cli.ts`, dev), and
  `install-commands` (`node scripts/install-commands.mjs`). `engines.node >= 22`, ESM.
- **`scripts/run-forge-cli.mjs`** is the stable resolver the wrappers call. Resolution order
  (`run-forge-cli.mjs:30-38`):
  1. `$FORGE_BIN` (explicit pin to a built binary),
  2. `forge` on `PATH` (e.g. after `pnpm link --global`),
  3. local-dev fallback `pnpm -s -C <forge-repo> forge …` (tsx).
  It forwards all argv verbatim, inherits stdio, and exits with the CLI's code. Cross-platform: uses
  `where`/`which` and `shell: true` on Windows (`run-forge-cli.mjs:21-27`).
- `pnpm build` emits `dist/cli.js`; `node dist/cli.js validate <epic>` is the documented built-binary path
  (`README.md:45-46`, `:160`).

**Verdict:** the CLI surface is sound. The resolver is the right abstraction and already handles all three
install styles. Nothing here is broken; the gaps are in *verification* and *docs*, not the engine.

### 1.2 Slash-command / agent install surface

- **`scripts/install-commands.mjs`** copies `commands/*.md → ~/.claude/commands/` and
  `agents/*.md → ~/.claude/agents/` (`install-commands.mjs:14-32`). It is a **blind overwrite copy**: every
  `.md` in each source dir is `copyFileSync`'d over the target, sorted, with a per-file log line.
- It **mkdirs** the targets, so a fresh machine works. It does **not**: stamp a version/provenance, compute or
  compare checksums, detect drift, prune removed files, support `--dry-run`, or uninstall.
- Its closing console note (`install-commands.mjs:35`) is **stale**: _"agent charters are definitions only —
  nothing dispatches them until the orchestrator exists."_ The orchestrator (`/forge-run-ticket`) now exists
  and dispatches them live (`README.md:253-254`). Misleading on every install.
- Installed artifacts today: **5 commands** (`forge-validate`, `forge-status`, `forge-import`,
  `forge-run-dry-run`, `forge-run-ticket`) and **4 agents** (`forge-engineer`, `forge-semantic-verifier`,
  `forge-scope-verifier`, `forge-pm`).

**Verdict:** install works but is **fire-and-forget with no feedback loop**. There is no way to answer "are my
installed commands current with my checkout?" — the single most important Lane-1 question.

### 1.3 Environment / path model (already well-formed in code)

- **`FORGE_REPO`** = the ForgeGate checkout, used **only** to locate the CLI. Every wrapper invokes
  `node "${FORGE_REPO:?set FORGE_REPO to your forge-gate checkout}/scripts/run-forge-cli.mjs" …` — note the
  `:?` guard, so a missing `FORGE_REPO` **fails loudly** with a message (`forge-validate.md:17`,
  `forge-run-ticket.md:12`, all five wrappers).
- **`TARGET_REPO`** = the project being modified = `git rev-parse --show-toplevel` of the open Claude Code
  project (`forge-run-ticket.md:13-14`). The orchestrator passes `--repo-root "$TARGET_REPO"` to **every** Core
  call that pins a root and runs all git/verify via `git -C "$TARGET_REPO"`. Tool repo ≠ target repo is
  enforced, not just documented.
- **`FORGE_BIN`** is supported for advanced users (pin a specific build) and is the recommended frozen-build
  pattern for self-modifying runs: `FORGE_BIN="node <repo>/dist/cli.js"` (`adopting…md:134-135`).
- **Read-only wrappers already absolutize** a relative epic against the target:
  `EPIC="$ARGUMENTS"; case "$EPIC" in /*|[A-Za-z]:[\\/]*) ;; *) EPIC="$TARGET_REPO/$EPIC" ;; esac`
  (`forge-validate.md:15-16`, same in `forge-status.md`, `forge-run-dry-run.md`). **Exception:**
  `forge-import.md:13` forwards `$ARGUMENTS` raw (it takes `--from-existing`/`--out`, not a single epic).
- `.gitignore` reserves the external-epic homes: `pilot-local/`, `sandbox-local/`, `*.private.md`, plus
  `.forge/`, `.claude/`, `dist/`, `node_modules/` (`.gitignore:6-17`). `sandbox-epic/` is intentionally tracked.

**Verdict:** the env/path model is the strongest part of the adoption surface — correct, fail-loud, and proven
by the DanJohnsonSite pilot. The work here is to *document the recommended shell setup*, not to change code.

### 1.4 Governance / template surface

- `templates/CLAUDE.md`, `templates/governance/*` (6 docs: ENGINEERING-STANDARDS, DEFINITION-OF-READY,
  DEFINITION-OF-DONE, SECURITY-STANDARDS, TESTING-STANDARDS, AGENT-WORKING-AGREEMENT), and
  `templates/epic-starter/` exist and are referenced by the adoption guide (`adopting…md:58-87`).
- Agents read `docs/governance/*` and a repo-root `CLAUDE.md` **if present** and degrade gracefully when
  absent (`adopting…md:60-62`). Seeding is **manual `cp -R`** today.

### 1.5 Existing documentation (do not duplicate — extend)

- `docs/adopting-forgegate-in-a-project.md` — the **Lane-2** guide (11 numbered steps, Git Bash first).
- `docs/first-pilot-checklist.md` — the pre-first-run gate (environment / target state / contract / ticket /
  safety-model checklists).
- `README.md` — `Install & setup` (`:144-150`), `CLI resolver and environment` (`:163-181`), wrapper smoke
  checklist (`:202-220`). These are accurate and current.

---

## 2. Current install model (synthesis)

```
ForgeGate checkout (FORGE_REPO)                     ~/.claude/ (global Claude Code config)
├─ dist/cli.js          ← pnpm build                ├─ commands/forge-*.md   ← copied by install-commands
├─ scripts/                                         └─ agents/forge-*.md     ← copied by install-commands
│   ├─ run-forge-cli.mjs ← CLI resolver (the wrappers call THIS, by FORGE_REPO abs path)
│   └─ install-commands.mjs ← blind copy, no verify
├─ commands/*.md (source of truth)                  Target repo (TARGET_REPO = git root of open project)
└─ agents/*.md   (source of truth)                  └─ (validate/dry-run/run-ticket operate here via --repo-root)

Resolution at run time:  wrapper → node $FORGE_REPO/scripts/run-forge-cli.mjs → [FORGE_BIN | forge-on-PATH | pnpm -C repo]
```

**The model is correct.** Its only structural weakness is that the `~/.claude` copies are **detached snapshots**
with no link back to the checkout's version — update the checkout and the copies silently go stale.

---

## 3. Gaps & risks

| # | Gap / risk | Evidence | Severity | Lane |
|---|---|---|---|---|
| G1 | **No install verification.** Can't tell if `~/.claude/{commands,agents}` match the checkout. Update the repo, forget to re-run `install-commands`, and you silently run stale wrappers/charters. **RESOLVED (PR #1):** `forge verify-install` now reports `current`/`stale`/`missing`. | `install-commands.mjs:14-32` (blind copy, no stamp/checksum) | **High** | 1, 2 |
| G2 | **Stale install message.** `install-commands.mjs:35` said charters "are definitions only — nothing dispatches them until the orchestrator exists." False since `/forge-run-ticket` shipped. **RESOLVED (PR #2):** the summary now points at `verify-install`, shows the re-run loop, and notes charters are dispatched live. | `install-commands.mjs:35` vs `README.md:253-254` | Medium | 1, 2 |
| G3 | **Adoption guide §6 partially stale.** Said read-only wrappers "do not yet take `--repo-root` … pass an absolute epic path." They now absolutize relative epics against `TARGET_REPO`, so relative paths work for in-target epics; absolute is only required for **external** epics. **RESOLVED (docs):** the adoption guide's epic-path note is corrected. | `adopting…md:99-106` vs `forge-validate.md:15-16` | Medium | 2 |
| G4 | **No documented "preferred" target-repo adoption model.** The proven pilot used an external `pilot-local/` epic + `--repo-root`; the adoption guide assumes an in-target `docs/epics/`. No guidance on which to use when, so an adopter can create a second source of truth. | `.gitignore:15-16`; `adopting…md:78-87` | Medium | 1, 2 |
| G5 | **`FORGE_REPO` durability is undocumented per-shell.** The `:?` guard fails loudly (good), but there's no canonical "set it once" recipe per platform; the guide gives Git Bash + a PowerShell aside but no durable-persistence recipe (`setx`, profile). | `adopting…md:23-35` | Low | 1, 2 |
| G6 | **No uninstall / prune.** Removed or renamed commands linger in `~/.claude`. Low impact at 5+4 files, but it's drift. | `install-commands.mjs` (copy-only) | Low | 1, 2 |
| G7 | **`forge-import` wrapper doesn't absolutize** and the guide notes external-epic import is rough. Minor: import is rare and takes explicit `--out`. | `forge-import.md:13`; `adopting…md:99-106` | Low | 2 |
| G8 | **Published-package path is unspecified.** `private: true`, `version 0.0.1`, `files:["dist"]`. If ForgeGate is ever `npm i -g`'d, `install-commands`/`run-forge-cli.mjs` would need to resolve from the installed package, not a checkout. Out of scope now; note it so Lane 3 doesn't get designed into a corner. | `package.json:2-16` | Low (future) | 3 |

**The throughline:** every high/medium gap except G3/G4 is an **install-verification** problem. Make
"is my install current and correct?" answerable and most of the Lane-1 friction disappears.

---

## 4. Recommended Lane 1 workflow (Dan, local/global, priority)

**Goal: one checkout, one update command, make it boring and repeatable.**

1. **One stable checkout** at a fixed path, e.g. `D:/Projects/forge-gate` (separate from this `D:/Projects/forge`
   dev checkout if you want a "released" copy; otherwise reuse this one).
2. **Durable `FORGE_REPO`.** Set it once in the shell profile so every session has it:
   - Git Bash: `echo 'export FORGE_REPO=/d/Projects/forge-gate' >> ~/.bashrc`
   - PowerShell: `setx FORGE_REPO "D:/Projects/forge-gate"` (persists; new shells pick it up).
   Rationale: durable beats per-session because the wrapper's `:?` guard already fails loudly if it's ever
   unset, so a stale/missing value can't silently misbehave. Per-session export stays the documented fallback.
3. **`forge` on PATH is optional, not required.** With `FORGE_REPO` set, the `pnpm -C` fallback works
   everywhere. `pnpm link --global` (or `FORGE_BIN`) is a speed/cleanliness upgrade, not a prerequisite.
4. **Update routine (the part that needs hardening):**
   ```
   cd $FORGE_REPO && git pull && pnpm install && pnpm build && pnpm test && pnpm install-commands
   ```
   Today there's no confirmation the `~/.claude` copies actually match after this. **This is what the proposed
   ticket fixes** (a verify step + provenance). Until then: re-run `install-commands` after *every* pull.
5. **Target repos stay clean.** Never install anything into a target. `/forge-run-ticket` already resolves the
   target by git root and pins `--repo-root`, so the target is touched only by an actual run (which stops at the
   commit gate).
6. **Where epics live (the key decision) — pick by intent, never both for the same work:**
   - **Disposable pilot / experiment → external + `--repo-root` (model A).** Epic under
     `$FORGE_REPO/pilot-local/<name>/` (gitignored), run with the target open. Zero target traces. This is the
     **proven** DanJohnsonSite pattern.
   - **Real, ongoing project work → committed `docs/epics/` in the target (model C).** The plan is
     version-controlled, reviewable, and the single source of truth — exactly what you want for genuine
     planning. Not zero-trace, but for *your own* repos that's correct: the epic *should* be part of history.
   - **Avoid model B (gitignored `.forgegate/` inside the target).** It's the worst of both: a hidden second
     source of truth that's trivially lost and invisible to reviewers. (See §6 comparison.)

**Net:** Lane 1 needs **zero behavior changes** — only (a) a durable `FORGE_REPO` recipe, (b) a verify step in
the update routine, and (c) a one-line "pilots → A, real work → C" rule. (a) and (c) are docs; (b) is the ticket.

---

## 5. Recommended Lane 2 workflow (public GitHub user)

The existing `docs/adopting-forgegate-in-a-project.md` already covers this well. The clean canonical flow:

```bash
git clone https://github.com/dsj7419/forge-gate.git
cd forge-gate
pnpm install
pnpm build
pnpm test                       # optional sanity — should be green
pnpm install-commands           # → ~/.claude/{commands,agents}
export FORGE_REPO=$(pwd)         # durable: add to ~/.bashrc  (PowerShell: setx FORGE_REPO "<path>")
# smoke check, inside Claude Code, in ANY repo:
/forge-validate src/validate/__fixtures__/valid-epic
/forge-run-dry-run src/validate/__fixtures__/valid-epic
```

**Gaps that would confuse a public user (fix in docs, folded into the ticket where code-touching):**

- **G2** stale install message — a brand-new user is told charters do nothing. Remove/replace the line.
- **G3** the adoption guide tells them to always use absolute epic paths; relative now works for in-target
  epics. Clarify: relative is fine for `docs/epics/` inside the open repo; absolute only for external epics.
- **No post-install confirmation.** `install-commands` prints what it copied but not "you're good / you're
  stale." A `verify-install` line in the smoke section closes this (G1).
- Otherwise the flow is accurate. The README's `Install & setup` + `CLI resolver and environment`
  (`README.md:144-181`) are correct and need no change.

---

## 6. Target-repo adoption models compared (PM question 4)

| Criterion | A. External epic + `--repo-root` (`pilot-local/`) | B. Gitignored `.forgegate/` in target | C. Committed `docs/epics/` in target |
|---|---|---|---|
| Zero-trace safety | **Best** — target never touched | Good — gitignored | Poor — epic+status committed |
| Repeatability | High | High | High |
| Works with ForgeGate commands | Yes (absolute epic path; orchestrator pins `--repo-root`) | Yes | **Yes, simplest** (relative path auto-absolutizes) |
| Real project planning | Poor — plan divorced from repo, low discoverability | Poor — hidden, easily lost | **Best** — versioned, reviewable, single truth |
| Public-user friendliness | Medium (must understand external + `--repo-root`) | Low (non-obvious) | **High** (matches the guide) |
| Second-source-of-truth risk | Low (clearly disposable) | **High** (hidden parallel plan) | Low (it *is* the truth) |

**Recommendation:** **A for disposable pilots, C for adopted real work, never B.** This is a documentation
decision plus the one-line rule in §4.6 — no code.

---

## 7. Future automation — evaluated, ranked, NOT built (PM question 7)

Ranked by (value ÷ risk), highest first:

1. **`pnpm verify-install` / `forge doctor` — BUILD FIRST (this is the proposed ticket).** Highest value,
   lowest risk: read-only, closes G1/G2, makes the update loop trustworthy. No behavior change.
2. **`install-commands` provenance + drift output.** Stamp installed version/commit and report match/stale on
   re-run. Pairs with #1. Low risk (additive output).
3. **macOS/Linux + Windows install/update one-liners (docs, not scripts).** Codify §4/§5 recipes. Near-zero
   risk. Could later become a thin script.
4. **`forge init-target` (seed governance/CLAUDE.md/epic-starter into a target).** Useful but writes into a
   target repo — defer until the manual `cp -R` flow is proven boring. Medium value, medium risk.
5. **Installer scripts (`install.sh` / `install.ps1`).** Only worth it once the manual flow is documented and
   `verify-install` exists. Medium value, medium risk (cross-platform surface).
6. **Plugin approach.** Premature — first prove the manual install end-to-end. Defer.
7. **Hooks (git pre-commit guard, etc.).** **Explicitly deferred by the PM and by me.** Hooks blur the
   "human explicitly invokes, stops at the commit gate" safety model. Highest risk to the product thesis.
   Do **not** build until install/update/adoption is boring and reliable.

---

## 8. Proposed next implementation ticket

Smallest independently-valuable, TDD-able slice that removes the top gap. **One ticket, read-only command,
no behavior change to any existing command.**

> ### Ticket: `forge verify-install` — report whether installed commands/agents match the checkout
>
> - **kind:** green · **risk:** low · **change_class:** feature · **blast_radius:** local
> - **One sentence:** Add a read-only `forge verify-install` (+ `pnpm verify-install`) that compares
>   `~/.claude/{commands,agents}/forge-*.md` against the checkout's `commands/`+`agents/` and reports
>   match / stale / missing, exit 0 if all current, 1 otherwise.
> - **allowed_paths:** `src/cli/**`, `src/install/**` (new module), `scripts/install-commands.mjs`
>   (only to add the stale-line fix G2 + call the shared compare), `package.json` (add the script),
>   `README.md`, `docs/adopting-forgegate-in-a-project.md` (G3 clarification), and the colocated `*.test.ts`.
> - **forbidden_paths:** `src/schema/**`, `src/guard/**`, `src/agents/parse-output.ts`,
>   `src/orchestrator/**`, `commands/**`, `agents/**` (do not change command/charter/guard/parser behavior).
> - **verify_commands:** `pnpm test`, `pnpm typecheck`.
> - **Acceptance criteria (RED-first):**
>   - Given a checkout file and an identical installed copy → reported `current`.
>   - Given an installed copy that differs (byte mismatch) → reported `stale`, exit 1.
>   - Given a checkout file with no installed counterpart → reported `missing`, exit 1.
>   - Given an all-current install → exit 0 with a clean summary.
>   - Pure compare logic lives in a testable module with the filesystem injected at the edge (match
>     `cli/run.ts`'s injected-IO pattern); no real `~/.claude` I/O in unit tests.
> - **Why this shape:** read-only, additive, mirrors the existing `CliIo` seam, kills G1, and lets G2 be fixed
>   in the same diff without touching command/guard/parser behavior. Describable in one sentence; one commit.

A likely **fast-follow** (separate ticket, not bundled): `install-commands` prints a provenance stamp and a
"run `forge verify-install` to confirm" line (G2 closure + #2 above). Keep it out of the first ticket to keep
that diff single-responsibility.

---

## 9. What NOT to build yet (explicit)

- **No hooks.** (PM + design agree — preserves the explicit-invoke / commit-gate safety model.)
- **No plugin.**
- **No installer scripts** (`.sh`/`.ps1`) until the manual flow + `verify-install` exist.
- **No `forge init-target`** (writes into target repos) until manual seeding is proven boring.
- **No status write-back / journal / auto-commit / push / PR / merge / multi-ticket** — unchanged v1 thesis.
- **No change to command, parser, or guard behavior.** The proposed ticket only *adds* a read-only command.
- **No published-package work** — note G8 so Lane 3 keeps the package path open, but don't act.

---

## 10. Approval gate

This document is design only. **Recommended next step:** approve the §8 ticket (`forge verify-install`), author
it from the epic starter, and run it through the normal one-ticket loop. Everything else stays deferred until
the install/update loop is boring.
