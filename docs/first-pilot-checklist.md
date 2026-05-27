# First-pilot checklist

Run through this before the **first** ForgeGate live run in any repo. If any box can't be checked, stop and fix
it first. (See [`adopting-forgegate-in-a-project.md`](adopting-forgegate-in-a-project.md) for the how-to.)

## Environment

- [ ] ForgeGate built (`pnpm build` in the ForgeGate repo) and its own tests/typecheck green.
- [ ] `FORGE_REPO` is set to the ForgeGate checkout (or `forge` is on `PATH` / `FORGE_BIN` is set).
- [ ] You understand `FORGE_REPO` (the ForgeGate **tool** checkout) is **separate** from the **target repo**
      (the project open in Claude Code). `/forge-run-ticket` resolves the target from the current git root
      (`git rev-parse --show-toplevel`), runs all git/verify there, and passes the CLI `--repo-root <target>`.
- [ ] `pnpm install-commands` run; `/forge-validate`, `/forge-run-dry-run`, `/forge-run-ticket` available in Claude Code.
- [ ] **Install currency confirmed:** after `pnpm build`, run `node dist/cli.js verify-install` (exit 0 = the
      installed `~/.claude` copies match this checkout). If it reports any file `stale`/`missing`, re-run
      `pnpm install-commands` then `node dist/cli.js verify-install` until it is clean.

## Target repo state

- [ ] Working tree is clean (`git status --porcelain` empty) before starting.
- [ ] The repo's own tests and typecheck are green at baseline (so verify results are meaningful).
- [ ] On the integration base (e.g. `main`); the run creates its own ticket branch.

## Contract

- [ ] An epic contract exists under `docs/epics/<slug>/` (authored from the starter template or imported).
- [ ] `/forge-validate <epic>` reports `OK` (0 errors).
- [ ] `/forge-run-dry-run <epic>` selects the **intended** ticket (not a stale or wrong one).

## The ticket is safe and well-fenced

- [ ] **Tiny and low-risk** — the smallest useful slice, not a whole sprint.
- [ ] `allowed_paths` is **narrow** (only what this ticket should touch).
- [ ] `forbidden_paths` is **explicit** (call out anything nearby it must not touch).
- [ ] `verify_commands` are present and concrete (test + typecheck/lint as applicable).
- [ ] Clear, checkable `## Acceptance Criteria`.
- [ ] **No** secrets, credentials, `.env`, production config, auth, migrations, or destructive filesystem work.
      (`change_class ∈ {migration, security, infra, dependency}` or such keywords auto-escalate the gate.)

## During / after the run (the safety model)

- [ ] The run **stops at the commit gate** — it makes **no** commit, push, PR, or merge.
- [ ] **No** status write-back and **no** journal automation happen (these are manual/deferred in v1).
- [ ] Only the ticket's `allowed_paths` changed (the scope verifier confirms this); `.forge/` artifacts stay gitignored.
- [ ] You review the diff + PM handoff, then commit/push/PR **by hand**.
- [ ] After merge, you **manually** set the ticket `status: merged` in the manifest **and** ticket front-matter.

## Hard stops — escalate, don't push through

- Invalid/unparseable agent output, a dirty tree at start, a lock present, a scope violation, or a verifier
  REJECT the PM can't resolve → **escalate to a human**. ForgeGate never guesses past these.
