---
schema_version: 1
id: T01
title: Add forge verify-install — read-only install-currency check
kind: green
risk: low
change_class: feature
blast_radius: local
status: merged
gate: pr
gate_override: false
allowed_paths: ["src/cli/run.ts", "src/cli/run.test.ts", "src/install/**", "scripts/install-commands.mjs", "README.md"]
forbidden_paths: ["src/schema/**", "src/validate/**", "src/guard/**", "src/orchestrator/**", "src/agents/**", "src/importer/**", "src/run/**", "src/index.ts", "commands/**", "agents/**", "docs/adopting-forgegate-in-a-project.md", "package.json", "pnpm-lock.yaml", "tsconfig.json", "vitest.config.ts"]
verify_commands: ["pnpm test", "pnpm typecheck"]
---
## Scope

Add a new read-only CLI command, `forge verify-install`, that answers one operational question:
**are the installed Claude commands and agent charters current with this ForgeGate checkout?**

The command compares each `*.md` file in the checkout's `commands/` and `agents/` directories against the
matching file under the user's Claude config home (`~/.claude/commands/` and `~/.claude/agents/`) and reports
each required file as `current`, `missing`, or `stale` (installed copy differs in content). It only reads and
compares — it writes nothing, and it installs, updates, or changes no file on disk.

Wire it into the CLI router (`src/cli/run.ts`) through the existing injected `CliIo` boundary, with the
comparison logic in a new, separately testable module under `src/install/`. As part of the same slice, correct
the now-inaccurate closing note printed by `scripts/install-commands.mjs` (it still says the charters do nothing
because the orchestrator does not exist; the orchestrator now dispatches them) — **message text only, no change
to install behavior** — and add a minimal `README.md` reference for the new command.

## Out of Scope

- Hooks, plugin packaging, installer scripts, `init-target`, or a `doctor` command.
- Any install, update, or file-changing action — `verify-install` only reports; it changes nothing on disk.
- `--json` output (a deferred fast-follow; keep this first slice to human-readable output + exit codes).
- Rewriting `docs/adopting-forgegate-in-a-project.md` or broader setup docs (a later ticket).
- New dependencies, `package.json` scripts, or config changes.
- Status write-back, journal automation, auto commit/push/PR/merge, or any multi-ticket behavior.

## AI Instructions

- Follow TDD: write a failing test first for each behavior below, then the simplest code to make it pass.
- **Read-only by construction:** the command performs no filesystem writes. Unit tests must prove this.
- **Inject the boundaries:** the checkout directory, the Claude config home directory, and the file reader are
  injected (mirror the `CliIo` seam already used in `src/cli/run.ts`) so tests run against temp fixtures and
  never touch the real `~/.claude`. Do not hardcode the real home directory in tests.
- **Required set = the checkout's own files:** the files to check are exactly the `*.md` files present in the
  checkout's `commands/` and `agents/` directories (the same set the install script copies). Compare by content
  equality.
- **Extra files:** a `forge-*.md` present in the installed location with no checkout counterpart is reported as
  informational `extra` and must **not** affect the exit code.
- **No new dependencies** — node builtins only (`fs`, `path`, `os`, optionally `crypto`).
- Touch only files under `allowed_paths`. The `scripts/install-commands.mjs` edit is the message string only.
- Keep the `README.md` change tiny — one command-reference entry plus its exit codes. Do not rewrite the
  adoption guide.
- Run `pnpm test` and `pnpm typecheck` and confirm both are green before reporting.

## Acceptance Criteria

- [ ] `forge verify-install` compares every `*.md` in the checkout's `commands/` and `agents/` directories
      against the matching file under the Claude config home, reporting each as `current`, `missing`, or `stale`.
- [ ] When every required file is present and byte-identical, the command prints a summary and exits `0`.
- [ ] When a required command file is absent from the installed location, it is reported `missing` and the
      command exits `1`.
- [ ] When a required agent file is absent from the installed location, it is reported `missing` and the
      command exits `1`.
- [ ] When a required command file's installed copy differs in content, it is reported `stale` and exits `1`.
- [ ] When a required agent file's installed copy differs in content, it is reported `stale` and exits `1`.
- [ ] A `forge-*.md` in the installed location with no checkout counterpart is reported as informational
      `extra` and does **not** change a `0` exit when all required files are current.
- [ ] A usage error (e.g. an unknown flag) exits `2`.
- [ ] The command writes nothing to disk (verified by a test that asserts no write occurs).
- [ ] The checkout path, Claude-home path, and file reader are injectable; tests use temp fixtures, never the
      real `~/.claude`.
- [ ] `src/cli/run.ts` routes `verify-install` through the injected `CliIo` boundary (router-level test).
- [ ] The closing note in `scripts/install-commands.mjs` is corrected so it no longer claims the charters are
      inert for lack of an orchestrator; install behavior is unchanged.
- [ ] `README.md` documents the command minimally (one reference entry + its exit codes).
- [ ] `pnpm test` and `pnpm typecheck` pass.
