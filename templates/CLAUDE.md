# CLAUDE.md (starter)

Repo-root AI working instructions for your project. Copy this to your repository **root** as `CLAUDE.md`
and adapt it — ForgeGate's agents read a repo-root `CLAUDE.md` if present and obey it. (This belongs at the
root, not under `docs/governance/`.) Keep it lean; put detailed standards in `docs/governance/*` and reference
them here rather than duplicating.

## About this repo

- **What it is:** <one or two sentences — what this project is and who it serves.>
- **Stack / commands:** <language/runtime; the build, test, typecheck/lint commands.>

## How to work here

- Follow `docs/governance/*` (engineering, testing, security, definition-of-ready/done) when present.
- Build in small, tested increments; keep the tree green. Prefer editing/deleting over adding code.
- No secrets in code or commits. Validate input at trust boundaries.
- Stay within a task's stated scope; if the task is wrong or ambiguous, stop and ask rather than guessing.

> ForgeGate note: this file is read by the engineer/verifiers/PM. If you have no project-specific
> instructions yet, the agents proceed on the ticket contract + `docs/governance/*` + their charters.
