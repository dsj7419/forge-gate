---
schema_version: 1
id: T02
title: README release-readiness documentation pass
kind: green
risk: low
change_class: docs
blast_radius: local
status: pending
gate: pr
gate_override: false
allowed_paths: ["README.md"]
forbidden_paths: ["src/**", "docs/epics/**", "commands/**", "agents/**", "scripts/**", "package.json", "pnpm-lock.yaml", "tsconfig.json", "vitest.config.ts"]
verify_commands: ["pnpm test", "pnpm typecheck"]
---
## Scope

Bring `README.md` in line with what Forge Core actually does today. The current README understates the
project: its "Status" section still says the importer and execution "are not built yet," and the "Agent
charters" section says "nothing dispatches them until the orchestrator is built" — both stale. The
orchestrator, importer, dispatch adapter, and `/forge-run-ticket` all exist and have driven a real
one-ticket run end-to-end. This ticket makes the README an honest, complete entry point. Documentation
only — no source, config, or contract changes.

## Out of Scope

- Any file other than `README.md`.
- Source, config, scripts, or contract edits.
- Any claim of full autonomy, unsupervised readiness, or maturity beyond a conservative human-gated v1.

## Design Notes — README outline / diff plan

Target section order (rewrite in place; keep the existing voice):

1. **Title + one-paragraph intro** (KEEP/REFRESH) — Forge Core, deterministic, CLI-first, runtime-agnostic; link
   the design spec. Position Forge as a **deterministic, human-gated orchestration layer for Claude Code — not a
   fully autonomous engineering system**. Avoid overclaiming anywhere in the document.
2. **Status** (REWRITE) — drop the stale "Milestone 1 / not built yet" text. State what exists today: read-only
   validator + CLI; importer; deterministic run-packet generation; dispatch adapter; agent-output validation;
   deterministic PM input assembly; the packaged `/forge-run-ticket` one-ticket loop, exercised on a real ticket.
   State plainly what is NOT built: hooks, status write-back, journal append, local commit-at-gate automation,
   multi-ticket loop.
3. **Quickstart** (NEW) — minimal happy path against an existing epic (`docs/epics/forge-self-improvement` or
   `sandbox-epic`): `pnpm install` → `pnpm build` → `node dist/cli.js validate <epic>` →
   `node dist/cli.js run <epic> --dry-run`. Note `/forge-run-ticket` is the interactive orchestration entry point.
4. **Commands** (EXPAND) — one line + flags for every shipped subcommand: `validate`, `status`, `import`,
   `run --dry-run`, `packets`, `dispatch <role>` (incl. `dispatch pm` input assembly), `parse-agent`. (Adds the
   three orchestration subcommands the current README omits.)
5. **Importing legacy sprints / Exit codes / Artifact behavior** (KEEP; light touch only).
6. **Install & setup** (NEW, or fold into Develop) — `pnpm install`, `pnpm build`, `pnpm install-commands`; the
   CLI resolver order and the roles of `FORGE_BIN` (pin a built binary) and `FORGE_REPO` (wrapper repo path).
7. **Claude Code wrappers** (UPDATE) — add `/forge-run-ticket` to the table; keep binary-resolution + smoke notes.
8. **The v1 safety model** (NEW) — one ticket per run; stop at the commit gate; no auto push / PR / merge; no
   status write-back; no journal write; engineer edits only `allowed_paths`; `.forge/` runtime artifacts are
   gitignored; `lock.json` guards concurrency; failed runs preserve evidence for human inspection. Include a
   **"Not autonomous / not magic"** statement: Forge *structures* Claude Code work and enforces discipline; the
   human stays responsible (Forge does not take that over), and v1 always stops at the commit gate.
9. **Agent charters** (REWRITE the "no live dispatch yet" claim) — the four charters are now dispatched live by
   `/forge-run-ticket`. Document the dispatch model: registered `forge-<role>` subagent types when the harness
   exposes them, else the deterministic fallback (general-purpose agent + the tracked charter body injected
   verbatim — never an improvised prompt).
10. **Current maturity & limitations** (NEW) — *Current maturity:* usable locally; proven on the `sandbox-epic`
    and one real Forge self-improvement ticket (T01); **not yet** published/released as a polished public package;
    no auto push/PR/merge, status write-back, or journal hooks yet. *Limitations:* registered `forge-*` subagent
    types may be unavailable in some harnesses (the deterministic injected-charter fallback handles it); v1 is
    intentionally conservative and human-gated; no autonomy or unsupervised-readiness claims.
11. **Principles** (KEEP).

## AI Instructions

- Read the current `README.md` fully before editing; preserve its voice and the accurate sections.
- Apply the section plan above. Every documented command/flag MUST match the real CLI surface — verify against
  `src/cli/run.ts` (the `USAGE` string + handlers) and the `commands/` wrappers; do not invent flags or behavior.
- State the build status and limitations honestly. Do not claim full autonomy or unsupervised readiness.
- Edit only `README.md`. Run the verify commands and confirm both are green (they prove the repo still builds and
  tests; a docs change must not break them).

## Acceptance Criteria

- [ ] The "Status" section no longer says the importer or execution are unbuilt; it accurately lists what exists
      and what is deferred.
- [ ] Every shipped CLI subcommand is documented: validate, status, import, run --dry-run, packets, dispatch
      (incl. dispatch pm input assembly), parse-agent.
- [ ] All `/forge-*` wrappers are listed, including `/forge-run-ticket`.
- [ ] Install/setup is documented: pnpm install, pnpm build, pnpm install-commands, and the roles of FORGE_BIN
      and FORGE_REPO.
- [ ] The v1 safety model is stated: one ticket, commit-gate stop, no auto push/PR/merge, no status write-back,
      no journal write, `.forge/` runtime artifacts, lock file.
- [ ] Limitations are stated: registered forge-* subagents may be unavailable (injected-charter fallback); v1 is
      conservative and human-gated; no autonomy/maturity overclaims.
- [ ] The safety model includes a "Not autonomous / not magic" statement: Forge structures Claude Code work, the
      human stays responsible, and v1 stops at the commit gate.
- [ ] A "Current maturity" section states: usable locally; proven on the sandbox and one real self-improvement
      ticket; not yet published/released; no auto push/PR/merge/status-write-back/journal hooks yet.
- [ ] The README positions Forge as a deterministic, human-gated orchestration layer for Claude Code (no overclaiming).
- [ ] A basic quickstart against an existing epic is included.
- [ ] Only `README.md` changed; `pnpm test` and `pnpm typecheck` pass.
