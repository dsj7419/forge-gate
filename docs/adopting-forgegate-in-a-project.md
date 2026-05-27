# Adopting ForgeGate in a project

How to install ForgeGate into any repo and run your first human-gated ticket. ForgeGate is **CLI-first** and
**runtime-agnostic**: the `forge` CLI is the engine, and the Claude Code slash commands are thin wrappers over
it. v1 runs **one ticket at a time** and always **stops at the commit gate** — you commit, push, and PR by hand.

Examples use **Windows / Git Bash** (this is a Windows workflow). PowerShell notes are called out where they differ.

---

## 1. Install ForgeGate (once per machine)

There are two setup lanes. They differ **only** in where the checkout comes from; from `pnpm install` onward the
steps are identical, and both end with `node dist/cli.js verify-install` confirming the installed `~/.claude`
copies are current. Setup is "done" at that verify step — **not** at `install-commands`.

### Lane B — public GitHub (clone fresh)

You do not have a checkout yet. Clone the ForgeGate repo somewhere stable, build it, install the commands, and
confirm currency:

```bash
git clone https://github.com/dsj7419/forge-gate.git /d/Projects/forge-gate
cd /d/Projects/forge-gate
pnpm install
pnpm build                        # emits dist/ (the binary the wrappers run)
pnpm install-commands             # commands/*.md → ~/.claude/commands, agents/*.md → ~/.claude/agents
node dist/cli.js verify-install   # confirm installed copies match this checkout (exit 0 = current)
```

Then set `FORGE_REPO` to your **fresh clone** (step 2).

### Lane A — Dan-local (reuse the existing checkout)

You already have the ForgeGate checkout at a stable path (e.g. `/d/Projects/forge-gate`). Bring it — and the
installed commands/charters — current from the existing checkout:

```bash
git pull                          # in your existing ForgeGate checkout
pnpm install
pnpm build                        # emits dist/
pnpm install-commands             # commands/*.md → ~/.claude/commands, agents/*.md → ~/.claude/agents
node dist/cli.js verify-install   # confirm installed copies match this checkout (exit 0 = current)
```

Then set `FORGE_REPO` to **that existing local checkout** (step 2).

### When verify-install reports stale/missing (either lane)

`verify-install` is read-only and lists each `~/.claude` file as `current`, `stale`, or `missing`. If anything
is `stale` or `missing` (e.g. you pulled but forgot to re-install), re-run the install and re-check:

```bash
pnpm install-commands
node dist/cli.js verify-install
```

> `node dist/cli.js verify-install` is the **primary** currency check because it works before the CLI is on
> `PATH`. `forge verify-install` is the same check, available once `forge` is on `PATH` (see step 2).

## 2. Set `FORGE_REPO` — the ForgeGate checkout (distinct from your target repo)

The slash-command wrappers use `FORGE_REPO` **only to locate the `forge` CLI** — it is **not** the project
being modified. **It is required**; set it to your ForgeGate checkout and export it durably (e.g. add to
`~/.bashrc`), not just for one shell:

```bash
export FORGE_REPO=/d/Projects/forge-gate          # Git Bash
# PowerShell:  $env:FORGE_REPO = 'D:/Projects/forge-gate'   (use setx for persistence)
```

**The value is lane-specific:**

- **Lane A (Dan-local):** `FORGE_REPO` = the path of the ForgeGate checkout you already have (e.g.
  `/d/Projects/forge-gate`) — the same checkout you `git pull` + rebuild + re-install in step 1.
- **Lane B (public GitHub):** `FORGE_REPO` = the path of the fresh clone from step 1 (`export FORGE_REPO=$(pwd)`
  from inside the clone is the simplest way to set it for the session).

Optional alternatives the resolver also accepts: set `FORGE_BIN` to pin a specific built binary, or
`pnpm -C /d/Projects/forge-gate link --global` to put `forge` on your `PATH`.

> **Tool repo vs. target repo (this is what makes ForgeGate work in *other* repos).** `FORGE_REPO` is the
> ForgeGate checkout — the engine. The **target repo** — the project a ticket actually modifies — is whatever
> repository you have open in Claude Code. `/forge-run-ticket` resolves the target automatically from the
> current project's git root (`git rev-parse --show-toplevel`), runs all git/verify operations there, and
> passes the CLI `--repo-root <target>` so packets/active-ticket/guard pin the target — never `FORGE_REPO`.
> The two coincide only when ForgeGate operates on itself; for any other project they differ.

## 3. The slash commands + agent charters are installed (step 1)

Step 1 already ran `pnpm install-commands` — copying `commands/*.md → ~/.claude/commands` and
`agents/*.md → ~/.claude/agents` — and confirmed the copies are current with `node dist/cli.js verify-install`.
After any ForgeGate update, re-run that install/verify loop (`pnpm install-commands` then
`node dist/cli.js verify-install`) so the installed copies stay current.

## 4. Confirm the slash commands are available

Open your target repo in Claude Code and confirm these appear: `/forge-validate`, `/forge-status`,
`/forge-import`, `/forge-run-dry-run`, `/forge-run-ticket`.

## 5. Seed governance docs (strongly recommended)

The agents (engineer, verifiers, PM) read `docs/governance/*` and a repo-root `CLAUDE.md` **if present**, and
obey any that exist. They are **not required for the CLI to run** — agents degrade gracefully and note a missing
doc rather than failing — but seeding them makes verification meaningfully stronger and the run feel
intentional. Copy the **full starter set** and adapt each to your stack:

```bash
cp -R /d/Projects/forge-gate/templates/governance docs/governance   # 6 docs: ENGINEERING-STANDARDS,
                                                                     # DEFINITION-OF-READY, DEFINITION-OF-DONE,
                                                                     # SECURITY-STANDARDS, TESTING-STANDARDS,
                                                                     # AGENT-WORKING-AGREEMENT
cp /d/Projects/forge-gate/templates/CLAUDE.md ./CLAUDE.md            # repo-root AI working instructions
# PowerShell: Copy-Item -Recurse <forgegate>/templates/governance docs/governance ; Copy-Item <forgegate>/templates/CLAUDE.md ./CLAUDE.md
```

These six `docs/governance/*` files plus the repo-root `CLAUDE.md` are exactly the set the agents and packets
reference. **Edit each to fit your project** — they are short, generic starters, not drop-in policy. Absence of
any one is tolerated; presence makes the verifiers stricter and more useful.

## 6. Create or import an epic contract

**New (author from the starter template):**

```bash
mkdir -p docs/epics
cp -r /d/Projects/forge-gate/templates/epic-starter docs/epics/my-first-epic
# edit docs/epics/my-first-epic/** — adapt the goal, and the T01 ticket's
# allowed_paths / forbidden_paths / verify_commands / Acceptance Criteria to your repo
```

**Or import a legacy sprint folder:**

```bash
/forge-import --from-existing path/to/legacy-sprint --out docs/epics/my-first-epic --dry-run   # preview
/forge-import --from-existing path/to/legacy-sprint --out docs/epics/my-first-epic              # write
```

> Keep the first ticket **tiny, low-risk, and tightly fenced** (narrow `allowed_paths`, explicit
> `forbidden_paths`, concrete `verify_commands`). No migrations, auth, secrets, or production config for a pilot.

### Where the epic lives — adoption model (pick one, never two for the same work)

The epic contract can live in three places. Choose by intent; mixing two creates a second source of truth.

- **A. External / gitignored epic — best for trace-free pilots.** The epic lives **outside** the target repo
  (e.g. under `$FORGE_REPO/pilot-local/<name>/`, which is gitignored), and you point ForgeGate at it with an
  absolute path while the target is open in Claude Code. The target repo is never touched by the contract
  itself, so a pilot leaves **zero traces**. This is the proven pilot pattern.
- **B. Committed `docs/epics` in the target repo — best for real, ongoing work.** The epic lives at
  `docs/epics/<slug>/` inside the target and is committed alongside the code. The plan is version-controlled,
  reviewable, and the single source of truth — exactly what you want for genuine planning. This is the default
  this guide assumes.
- **C. Hidden per-target gitignored planning folder — not recommended.** A gitignored planning folder *inside*
  the target (e.g. `.forgegate/`). It is the worst of both: a hidden parallel plan that is easily lost and
  invisible to reviewers, **creating a second source of truth**. Avoid it.

> **Relative vs. absolute epic paths (read-only wrappers — corrected).** `/forge-run-ticket` resolves the target
> repo and absolutizes the epic for you. The read-only wrappers `/forge-validate`, `/forge-status`, and
> `/forge-run-dry-run` now **absolutize a relative epic path against `TARGET_REPO`** (the git root of the open
> project), so **relative paths work for in-target epics** (model B) — e.g. `/forge-validate docs/epics/my-first-epic`.
> **Absolute epic paths are useful/required for external epics** (model A), which live outside the target.
> (Exception: `/forge-import` forwards its arguments raw and does not absolutize; pass it an explicit `--out`
> path — absolute when importing for an external/model-A epic.)

## 7. Validate the contract

```bash
/forge-validate docs/epics/my-first-epic                          # model B: relative resolves against TARGET_REPO
/forge-validate /abs/path/to/external/epics/my-first-epic         # model A: external epic → absolute path
```

Fix any findings until it reports `OK`. A contract with `TODO` placeholders (from import) is a human-completion
draft and will intentionally fail until you complete it.

## 8. Dry-run (read-only preview)

```bash
/forge-run-dry-run docs/epics/my-first-epic                          # model B: relative resolves against TARGET_REPO
/forge-run-dry-run /abs/path/to/external/epics/my-first-epic         # model A: external epic → absolute path
```

Confirm it selects the ticket you intend, with the right paths, verify commands, and gate. Nothing changes.

## 9. Run one ticket

```bash
/forge-run-ticket docs/epics/my-first-epic
```

This dispatches engineer → semantic verifier → scope verifier → PM, runs the verify commands independently,
checks scope, and **stops at the commit gate**. It makes **no** commit, push, PR, or merge.

> Tip: if the ticket edits ForgeGate's own source or any code the run itself executes, drive it with a frozen
> build (`pnpm build` then `FORGE_BIN="node <repo>/dist/cli.js"`) so the run can't modify its own tooling.

## 10. Human review and integration (manual)

After PASS at the gate, **you**:

1. Review the diff and the handoff (changed files, verification summary, PM decision).
2. Commit on the ticket branch, then integrate (`git merge --ff-only`, push, open a PR) — your call.
3. ForgeGate does none of this automatically in v1.

## 11. Mark ticket status after merge (manual, for now)

There is no automated status write-back yet. After a ticket is merged, update its status by hand so the next
dry-run selects the next ticket (not the finished one):

- set `status: merged` in `docs/epics/<epic>/<sprint>/manifest.yaml` **and** in the ticket's front-matter
  (they must agree — `forge validate` checks this).

---

## What ForgeGate does NOT do (v1)

v1 runs **one low-risk ticket at a time and stops at the commit gate.** No auto commit / push / PR / merge · no
status write-back · no journal write · no multi-ticket loop. Hooks (path-fence pre-commit), `forge doctor`,
`forge init-target`, and an installer/plugin remain **future work — not yet built**. These are deliberately
deferred; the human stays in control at the gate.

See also: [`first-pilot-checklist.md`](first-pilot-checklist.md) before your first real run.
