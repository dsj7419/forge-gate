# Adopting ForgeGate in a project

How to install ForgeGate into any repo and run your first human-gated ticket. ForgeGate is **CLI-first** and
**runtime-agnostic**: the `forge` CLI is the engine, and the Claude Code slash commands are thin wrappers over
it. v1 runs **one ticket at a time** and always **stops at the commit gate** — you commit, push, and PR by hand.

Examples use **Windows / Git Bash** (this is a Windows workflow). PowerShell notes are called out where they differ.

---

## 1. Install ForgeGate (once per machine)

Clone the ForgeGate repo somewhere stable and build it:

```bash
git clone https://github.com/dsj7419/forge-gate.git /d/Projects/forge-gate
cd /d/Projects/forge-gate
pnpm install
pnpm build      # emits dist/ (the binary the wrappers run)
pnpm test       # optional sanity: should be green
```

## 2. Set `FORGE_REPO` — the ForgeGate checkout (distinct from your target repo)

The slash-command wrappers use `FORGE_REPO` **only to locate the `forge` CLI** — it is **not** the project
being modified. **It is required**; set it to your ForgeGate checkout and export it durably (e.g. add to
`~/.bashrc`), not just for one shell:

```bash
export FORGE_REPO=/d/Projects/forge-gate          # Git Bash
# PowerShell:  $env:FORGE_REPO = 'D:/Projects/forge-gate'   (use setx for persistence)
```

Optional alternatives the resolver also accepts: set `FORGE_BIN` to pin a specific built binary, or
`pnpm -C /d/Projects/forge-gate link --global` to put `forge` on your `PATH`.

> **Tool repo vs. target repo (this is what makes ForgeGate work in *other* repos).** `FORGE_REPO` is the
> ForgeGate checkout — the engine. The **target repo** — the project a ticket actually modifies — is whatever
> repository you have open in Claude Code. `/forge-run-ticket` resolves the target automatically from the
> current project's git root (`git rev-parse --show-toplevel`), runs all git/verify operations there, and
> passes the CLI `--repo-root <target>` so packets/active-ticket/guard pin the target — never `FORGE_REPO`.
> The two coincide only when ForgeGate operates on itself; for any other project they differ.

## 3. Install the slash commands + agent charters

From the ForgeGate repo:

```bash
pnpm install-commands     # copies commands/*.md -> ~/.claude/commands, agents/*.md -> ~/.claude/agents
```

## 4. Confirm the slash commands are available

Open your target repo in Claude Code and confirm these appear: `/forge-validate`, `/forge-status`,
`/forge-import`, `/forge-run-dry-run`, `/forge-run-ticket`. (Re-run `pnpm install-commands` after any ForgeGate
update so the installed copies stay current.)

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

> **External-repo epic paths (read-only wrappers).** `/forge-run-ticket` resolves the target repo and
> absolutizes the epic for you, so a relative path is fine there. The read-only wrappers below —
> `/forge-validate`, `/forge-run-dry-run`, `/forge-status`, `/forge-import` — do **not** yet take `--repo-root`,
> and under the pnpm-fallback CLI resolution the CLI's working directory can be your **ForgeGate checkout**, not
> the target. **Robust default: pass an absolute epic path** to these. (Alternatively, install `forge` via
> `FORGE_BIN` or `pnpm link --global` so the CLI inherits the target's cwd and relative paths resolve there.) A
> small future follow-up may add target-repo/`--repo-root` handling to these wrappers; until then, absolute epic
> paths are the safe external pattern.

## 7. Validate the contract

```bash
/forge-validate /abs/path/to/your-repo/docs/epics/my-first-epic   # absolute path (see note above)
```

Fix any findings until it reports `OK`. A contract with `TODO` placeholders (from import) is a human-completion
draft and will intentionally fail until you complete it.

## 8. Dry-run (read-only preview)

```bash
/forge-run-dry-run /abs/path/to/your-repo/docs/epics/my-first-epic   # absolute path (see note above)
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

No auto commit / push / PR / merge · no status write-back · no journal automation · no path-fence hooks ·
no multi-ticket loop. These are deliberately deferred; the human stays in control at the gate.

See also: [`first-pilot-checklist.md`](first-pilot-checklist.md) before your first real run.
