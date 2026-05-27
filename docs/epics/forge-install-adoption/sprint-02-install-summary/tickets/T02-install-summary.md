---
schema_version: 1
id: T02
title: Improve install-commands post-install summary
kind: green
risk: low
change_class: feature
blast_radius: local
status: pending
gate: pr
gate_override: false
allowed_paths: ["scripts/install-commands.mjs", "src/scripts/install-commands.integration.test.ts"]
forbidden_paths: ["src/cli/**", "src/install/**", "commands/**", "agents/**", "package.json", "pnpm-lock.yaml", "vitest.config.ts", "docs/adopting-forgegate-in-a-project.md"]
verify_commands: ["pnpm test", "pnpm typecheck"]
---
## Scope

Make the install/update loop clearer after `pnpm install-commands`. Now that `forge verify-install` exists, the
install script should guide the user into the detect → remediate → confirm workflow: after copying the command
wrappers and agent charters, print a concise summary of what was installed and exactly what to run next.

Replace only the tail summary lines of `scripts/install-commands.mjs`. The per-file `installed …` lines and the
copy logic (`installDir`) stay exactly as they are. Target output (final wording may be refined, but keep it
accurate and imply no hooks/automation):

```
Installed ForgeGate Claude integration under <claude-home>:
  commands: <n>
  agents:   <n>

Next — confirm the installed files match this checkout:
  node dist/cli.js verify-install        (exit 0 = current; 1 = stale/missing)

If it reports stale or missing files, re-run:
  pnpm install-commands
  node dist/cli.js verify-install

If the `forge` CLI is on PATH, you may also run:
  forge verify-install

Agent charters are dispatched live by the `/forge-run-ticket` orchestrator.
```

`node dist/cli.js verify-install` is the **primary** recommended command because it works before the CLI is
globally linked; `forge verify-install` is mentioned only as an option for when the CLI is on PATH.

## Out of Scope

- Hooks, plugin packaging, installer scripts, `init-target`, or a `doctor` command.
- Running `verify-install` automatically after copy (only recommend it; do not invoke it).
- Any change to copy behavior, the set of files copied, or the installed file contents.
- New dependencies, `package.json` scripts, or `vitest.config.ts` changes.
- `README.md` or `docs/adopting-forgegate-in-a-project.md` edits (the script output is the improvement; public
  setup docs are a later ticket).
- Status write-back, journal automation, auto commit/push/PR/merge, or any multi-ticket behavior.

## AI Instructions

- Follow TDD: add the failing integration test first, then make the script output satisfy it.
- Change **only** the tail summary in `scripts/install-commands.mjs`. Do not alter `installDir` or the copy loop.
- **Test via subprocess** (mirror `src/cli/resolver.integration.test.ts`): run `node scripts/install-commands.mjs`
  with `USERPROFILE` and `HOME` redirected to a fresh temp directory so `os.homedir()` resolves there and the
  real `~/.claude` is never touched. Do not import the `.mjs` into the test (keeps strict typecheck clean).
- No new dependencies — node builtins only.
- Keep the output deterministic enough to assert on (stable guidance lines; counts may vary).
- Run `pnpm test` and `pnpm typecheck` and confirm both are green before reporting.

## Acceptance Criteria

- [ ] After copying, `pnpm install-commands` prints a summary stating the Claude config home path and the counts
      of installed command wrappers and agent charters.
- [ ] The summary names `node dist/cli.js verify-install` as the primary next step (with its 0/1 exit meaning).
- [ ] The summary shows the re-run path (`pnpm install-commands` then `node dist/cli.js verify-install`) for when
      files are reported stale or missing.
- [ ] The summary mentions `forge verify-install` only as an option for when the CLI is on PATH.
- [ ] The summary implies no hooks/automation and does not claim `verify-install` runs automatically.
- [ ] The copy behavior of `installDir` is unchanged (same files copied to `~/.claude/commands` and
      `~/.claude/agents`).
- [ ] A new subprocess integration test at `src/scripts/install-commands.integration.test.ts` runs
      `node scripts/install-commands.mjs` with `USERPROFILE`/`HOME` redirected to a temp directory and asserts:
      (a) the `verify-install` guidance appears in stdout; (b) command `*.md` files are copied to
      `<temp>/.claude/commands`; (c) agent `*.md` files are copied to `<temp>/.claude/agents`; (d) only the temp
      home is used — the real `~/.claude` is never touched.
- [ ] `pnpm test` and `pnpm typecheck` pass.
