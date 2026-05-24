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

## 2. Point ForgeGate at itself: `FORGE_REPO`

The slash-command wrappers locate the CLI via `FORGE_REPO`. **It is required** — set it to your ForgeGate
checkout. Export it durably (e.g. add to `~/.bashrc`), not just for one shell:

```bash
export FORGE_REPO=/d/Projects/forge-gate          # Git Bash
# PowerShell:  $env:FORGE_REPO = 'D:/Projects/forge-gate'   (use setx for persistence)
```

Optional alternatives the resolver also accepts: set `FORGE_BIN` to pin a specific built binary, or
`pnpm -C /d/Projects/forge-gate link --global` to put `forge` on your `PATH`.

## 3. Install the slash commands + agent charters

From the ForgeGate repo:

```bash
pnpm install-commands     # copies commands/*.md -> ~/.claude/commands, agents/*.md -> ~/.claude/agents
```

## 4. Confirm the slash commands are available

Open your target repo in Claude Code and confirm these appear: `/forge-validate`, `/forge-status`,
`/forge-import`, `/forge-run-dry-run`, `/forge-run-ticket`. (Re-run `pnpm install-commands` after any ForgeGate
update so the installed copies stay current.)

## 5. Seed governance docs (recommended)

The agents read `docs/governance/*` if present. Copy the starters into your target repo and adapt:

```bash
mkdir -p docs/governance
cp /d/Projects/forge-gate/templates/governance/DEFINITION-OF-DONE.md docs/governance/
cp /d/Projects/forge-gate/templates/governance/TESTING-STANDARDS.md  docs/governance/
```

Absence is handled gracefully (agents proceed on the ticket + charter alone), but seeded standards make
verification stronger.

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

## 7. Validate the contract

```bash
/forge-validate docs/epics/my-first-epic
```

Fix any findings until it reports `OK`. A contract with `TODO` placeholders (from import) is a human-completion
draft and will intentionally fail until you complete it.

## 8. Dry-run (read-only preview)

```bash
/forge-run-dry-run docs/epics/my-first-epic
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
