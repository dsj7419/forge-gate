---
schema_version: 1
id: T03
title: Document Dan-local and public GitHub setup workflows
kind: green
risk: low
change_class: docs
blast_radius: local
status: pending
gate: pr
gate_override: false
allowed_paths: ["README.md", "docs/adopting-forgegate-in-a-project.md", "docs/first-pilot-checklist.md", "docs/install-adoption-design.md"]
forbidden_paths: ["src/**", "scripts/**", "commands/**", "agents/**", "package.json", "pnpm-lock.yaml", "tsconfig.json", "vitest.config.ts", "docs/epics/**"]
verify_commands: ["pnpm test", "pnpm typecheck"]
---
## Scope

Now that `forge verify-install` exists and `pnpm install-commands` points at it, bring the setup docs in line
with product reality. The docs currently stop the install flow too early (at `install-commands`) and conflate
two distinct audiences. This ticket makes the install → verify loop factual and splits the setup into two
clearly labelled lanes, documents the epic-placement adoption model, corrects one stale instruction, and
restates the v1 boundaries. **Docs only — no code, scripts, or config changes.**

## Out of Scope

- Any code, script, command-wrapper, charter, or config change (docs-only).
- Documenting setup for hooks, `forge doctor`, `forge init-target`, or an installer/plugin — those are future
  work and should only be named as "not yet built," never given setup steps.
- Rewriting unrelated README sections; keep edits focused on setup/adoption/boundaries.
- New dependencies. Status write-back, journal automation, or multi-ticket behavior.

## AI Instructions

- Edit only the four `allowed_paths` docs. Keep the existing honest, no-overclaim voice.
- The install flow's confirmation step is `node dist/cli.js verify-install` (primary, works before the CLI is
  on PATH); `forge verify-install` is only an option for when the CLI is on PATH.
- Use the adoption-model lettering exactly as in the Acceptance Criteria (A external, B committed, C hidden).
- Do not introduce content about automation that does not exist. Run `pnpm test` and `pnpm typecheck` and
  confirm both are green before reporting (they should be unaffected by docs).

## Acceptance Criteria

- [ ] A **Dan-local** setup workflow is documented: from the existing checkout — `git pull` → `pnpm install`
      → `pnpm build` → `pnpm install-commands` → `node dist/cli.js verify-install`, including the re-run loop
      (`pnpm install-commands` then `node dist/cli.js verify-install`) when files are stale or missing.
- [ ] A **public GitHub** setup workflow is documented: `git clone …` → `pnpm install` → `pnpm build` →
      `pnpm install-commands` → `node dist/cli.js verify-install`, then setting `FORGE_REPO` for the
      shell/session.
- [ ] The two lanes are clearly distinguished: Dan-local reuses the existing checkout (`FORGE_REPO` = the local
      ForgeGate checkout path); public users clone fresh and set `FORGE_REPO` to their clone.
- [ ] The install flow ends with `node dist/cli.js verify-install` as the currency-confirmation step (not at
      `install-commands`).
- [ ] The epic-placement adoption model is documented with three options: **A.** external / gitignored epic —
      best for trace-free pilots; **B.** committed `docs/epics` in the target repo — best for real ongoing work;
      **C.** hidden per-target gitignored planning folder — not recommended (creates a second source of truth).
- [ ] The stale read-only-wrapper guidance is corrected: relative epic paths work for in-target epics (the
      `/forge-validate`, `/forge-status`, `/forge-run-dry-run` wrappers absolutize them against `TARGET_REPO`);
      absolute epic paths are useful/required for external epics.
- [ ] The v1 boundaries are stated clearly: one low-risk ticket at a time; stops at the commit gate; no
      auto-commit / push / PR / merge / status-write-back / journal-write; hooks, `doctor`, `init-target`, and
      installer/plugin remain future work.
- [ ] `docs/first-pilot-checklist.md` Environment section includes a verify-install currency check (build, then
      `node dist/cli.js verify-install`, re-running `install-commands` if stale).
- [ ] `docs/install-adoption-design.md` notes `verify-install` (PR #1) and the `install-commands` summary
      (PR #2) as shipped, and that the read-only-wrapper guidance gap is addressed.
- [ ] No file outside `allowed_paths` is changed; `pnpm test` and `pnpm typecheck` pass.
