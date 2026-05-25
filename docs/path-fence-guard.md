# Path-fence guard (`forge guard paths`)

A deterministic, read-only check that the current worktree's changes stay inside the active ticket's
path fence. It is the Core, no-LLM counterpart to the scope verifier — small enough to drop into a git
hook so a stray edit is caught *before* it is committed.

```bash
forge guard paths [--active <active-ticket.json>] [--json]
```

- **Exit `0`** — every changed file is inside `allowed_paths` and touches no forbidden/protected path.
- **Exit `1`** — one or more fence violations, or the active-ticket file is missing/invalid, or the
  worktree root does not match the ticket's `repo_root`.
- **Exit `2`** — usage error (unknown flag, missing `paths` subcommand).
- It **writes nothing** and **installs nothing**.

## What it does

1. Reads the active-ticket file (default `.forge/active-ticket.json`, override with `--active`).
2. Reads the worktree's changed files via `git status --porcelain -z` (added, modified, deleted,
   untracked, and **both** sides of a rename). The `-z` form is used deliberately: paths are emitted
   verbatim with no quoting, so a file whose path contains a space or special character is still
   matched against the fence rather than slipping through.
3. Reports every changed file that escapes the fence, with a stable finding code:

   | Code | Meaning |
   |------|---------|
   | `ACTIVE_TICKET_MISSING` | the active-ticket file does not exist |
   | `ACTIVE_TICKET_INVALID` | malformed JSON, wrong `schema` tag, or a missing required field |
   | `PATH_OUTSIDE_ALLOWED` | a changed file matches none of `allowed_paths` |
   | `FORBIDDEN_PATH_TOUCHED` | a changed file matches a `forbidden_paths` glob |
   | `PROTECTED_PATH_TOUCHED` | a changed file matches a `protected_paths` glob |
   | `REPO_ROOT_MISMATCH` | the worktree root differs from the ticket's `repo_root` (wrong repo / wrong cwd) |

Precedence per file is **forbidden → protected → outside-allowed**, so an explicit forbid or protect
always wins over a broad `allowed_paths` that would otherwise cover it. Globs use
[`picomatch`](https://github.com/micromatch/picomatch) with `dot: true`, so `**` also matches dotfiles
(e.g. a forbidden `.env`).

On a `REPO_ROOT_MISMATCH` — or when the command is run outside any git repo — the guard refuses to read
or judge the worktree: evidence gathered in the wrong repository is invalid evidence.

## The active-ticket file (`forge-active-ticket/v1`)

The guard reads a small, gitignored JSON file the orchestration shell writes for the active run:

```json
{
  "schema": "forge-active-ticket/v1",
  "repo_root": "/abs/path/to/repo",
  "epic_path": "docs/epics/my-epic",
  "ticket": "T01",
  "branch": "forge/my-epic/T01-slug",
  "allowed_paths": ["src/feature/**"],
  "forbidden_paths": ["package.json", "pnpm-lock.yaml"],
  "protected_paths": ["**/manifest.yaml", "**/epic.yaml", "**/JOURNAL.md", "**/DECISIONS.md", "docs/governance/**"]
}
```

- **Required:** `schema`, `repo_root`, `ticket`, `allowed_paths`, `forbidden_paths`, `protected_paths`.
  A missing required field fails loudly as `ACTIVE_TICKET_INVALID` — it is never silently defaulted.
- **`repo_root` must be an absolute path.** The guard rejects wrong-cwd evidence by comparing the
  worktree root to `repo_root`; a relative value (e.g. `.`) would resolve against the guard's own
  working directory and silently defeat that check, so it is rejected as `ACTIVE_TICKET_INVALID`.
- **Optional:** `epic_path`, `branch`.
- **Extra fields are tolerated.** The run also records operational fields (e.g. `gate`, `phase`,
  `timestamp`); the guard ignores unknown keys so the file can carry more than the guard needs without
  breaking. (This is a deliberate, forward-compatible exception to Forge's strict-schema rule.)

## How it differs from the scope verifier

| | Scope verifier | `forge guard paths` |
|---|---|---|
| What it is | a dispatched Claude Code **agent** that reasons over the diff | **deterministic Core code** — no model, no dispatch |
| Judgment | semantic ("is this change in scope and sensible?") | mechanical ("is every changed path inside the fence?") |
| Where it runs | inside the orchestration loop | anywhere — terminal, CI, or a git hook |
| Cost / speed | a model turn | a `git status` + glob match |

They are complementary: the guard is a cheap, fast tripwire that can run *before* and *independently of*
the agents; the scope verifier remains the semantic judge inside the loop. The guard does **not** replace
the verifier's reasoning, and a clean guard result is not a substitute for review.

## Using it from a future git hook

The guard is built to be hook-callable, but **it does not install any hook** — wiring is left to the
adopter. A minimal `.git/hooks/pre-commit` (made executable) could be:

```sh
#!/bin/sh
# Block a commit that strays outside the active ticket's fence.
node "${FORGE_REPO:?set FORGE_REPO}/dist/cli.js" guard paths --active "$(git rev-parse --show-toplevel)/.forge/active-ticket.json" || {
  echo "pre-commit: change is outside the active ticket fence — aborting." >&2
  exit 1
}
```

A `pre-push` hook is analogous. Because the guard exits non-zero on any violation, the hook blocks the
operation automatically. When no run is active, simply remove (or don't write) `.forge/active-ticket.json`
— the guard then reports `ACTIVE_TICKET_MISSING` and the hook can choose to skip rather than block.

## Limitations (v1)

- **No hook installation.** This is the check only; wiring a hook is the adopter's choice (above).
- **Consumes `forge-active-ticket/v1` only.** Producing that file is the orchestration shell's job;
  wiring `/forge-run-ticket` to emit `schema` + `repo_root` (and to call the guard at its scope-check
  step) is a separate, small follow-up.
- **Rename detection follows git.** A rename is only treated as a rename when git reports one (a staged
  rename); an unstaged move that git reports as a delete + an untracked add is checked as those two
  paths, which is still correct for the fence.
- **No semantic judgment.** It checks *paths*, not whether the change is correct or in spirit — that is
  the scope and semantic verifiers' job.
- An unexpected `git status` failure surfaces as a process error / non-zero exit, not a guard finding.
