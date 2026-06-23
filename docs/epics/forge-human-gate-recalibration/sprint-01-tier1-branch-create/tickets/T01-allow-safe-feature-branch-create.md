---
schema_version: 1
id: T01
title: Allow safe feature-branch creation in the permissions hook (Tier 1)
kind: green
risk: high
change_class: feature
blast_radius: app
status: pending
depends_on: []
blocks: []
allowed_paths:
  - .claude/hooks/**
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - node .claude/hooks/forge-permissions.selfcheck.mjs
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - .claude/settings.json
  - .claude/settings.local.json
  - src/**
  - src/cli.ts
  - src/index.ts
  - commands/**
  - workflows/**
  - agents/**
  - scripts/**
  - package.json
  - pnpm-lock.yaml
  - tsconfig.json
  - vitest.config.ts
  - README.md
  - .github/**
  - docs/**
  - docs/governance/**
  - sandbox-epic/**
  - pilot-local/**
  - templates/**
  - "**/.forge/**"
---

# T01 — Allow safe feature-branch creation in the permissions hook (Tier 1)

## Scope

Extend the four-class permissions hook (`.claude/hooks/forge-permissions.mjs`) so a non-runner agent may create a
**safe feature branch** with `git switch -c <branch>`, where `<branch>` passes the existing safe-feature-branch shape
filter. This is the Tier-1 (mechanical, local, reversible) slice of the human-gate re-calibration: branch creation
encodes no human decision and is trivially reversible, so it should not require a human to type it. The change is a
**pure additive ALLOW** in the hook's `switch` classifier; the proven deny engine, every existing Class-1/2/3/4 case,
the Tier-3 destructive set, and the runner L3 backstop are left exactly as they are.

## Core invariant (the reason this ticket exists, and its bound)

> Creating a simple feature branch is local and reversible and carries no irreversible or shared-state effect, so the
> hook may ALLOW `git switch -c <safe-feature-branch>` for a non-runner agent. The branch name must clear the SAME
> shape filter the push allowlist uses (`isSafeFeatureBranch`): a simple feature branch, never `main`/`master`/`HEAD`,
> never a `refs/…` / leading-`+`/`-` / colon-refspec / `..` / `@`/`~`/`^` / glob / backslash / empty-or-dot-segment
> form. `git switch -C` (force-create/reset), any additional flag (`--force`/`--detach`/`--discard-changes`/…), and any
> additional positional (a start-point) remain DENY. Runner (`forge-*`) agents get NO branch creation (L3 unchanged).

## Discovery findings (inspected, not assumed; baseline `a14701b`)

1. **Today `git switch -c …` is DENY.** The `switch` classifier rejects any flag — `if (clean.startsWith("-")) return
   { ok: false }` (`.claude/hooks/forge-permissions.mjs`, the `switch` block) — so `-c` is refused; the catch-all at
   the end of `classifyGit` also lists branch-creation as DENY. The hook emits `permissionDecision: "deny"`.
2. **The safe-branch shape filter already exists.** `isSafeFeatureBranch` (rejects protected/default + unsafe shapes)
   and `isSimpleBranchNameShape` are already used by the push allowlist and the `switch <branch>` allowlist. Tier 1
   reuses `isSafeFeatureBranch` for the new `-c` target — no new shape logic.
3. **Token de-quoting is already in place.** `deQuoteToken` is applied per-token in the `switch` block, so quoted /
   backslash-spliced spellings (`"-c"`, `"main"`, `ma\in`) are normalized before the checks — the new allow-shape
   inherits that hardening.
4. **The change is reachable only on the simple/static path** (no dangerous chars, no `META_CHARS`); any
   complex/dynamic/obfuscated form still falls to the deny engine, unchanged.

## Required change

In `classifyGit`'s `switch` handling, recognize the exact shape `git switch -c <branch>` (the `-c` flag followed by
exactly one positional, no other flags, no start-point) and return a known-safe ALLOW **iff** the de-quoted `<branch>`
passes `isSafeFeatureBranch`. Everything else about `switch` is unchanged: `git switch <existing-branch>` keeps its
current Class-1 allow; `-C`, extra flags, extra positionals, `HEAD`/`@…`, and unsafe branch shapes stay DENY. No other
classifier, the deny engine, the runner read-only path, and the decision/IO wrapper are untouched. Update
`.claude/hooks/forge-permissions.selfcheck.mjs` with RED-first cases.

## AI Instructions

- TDD: add the new self-check cases to `.claude/hooks/forge-permissions.selfcheck.mjs` (RED first), then change
  `.claude/hooks/forge-permissions.mjs`.
- **Verify through the pure `decide()` self-check, never by trusting the live session.** The hook governs this very
  session; do not rely on running a live `git switch -c` to "test" the change — run the self-check script, which
  exercises `decide()` directly.
- Keep the change strictly additive (only the `switch -c` allow-shape). Do **not** touch the deny engine, the
  de-obfuscation scan, the dangerous-char gates, `.claude/settings.json`, or any other classifier.
- Do not touch any forbidden path. If the change appears to need a deny-engine edit or a settings change, **stop and
  report**.
- `node .claude/hooks/forge-permissions.selfcheck.mjs`, `pnpm test`, and `pnpm typecheck` all green; scope guard clean.

## Acceptance Criteria

1. The hook **ALLOWS** `git switch -c <safe-feature-branch>` for a non-runner agent (e.g. `git switch -c
   forge/x/y-z`, `git switch -c feature/abc`) — `permissionDecision: "allow"`.
2. The hook **DENIES** `git switch -c main`, `git switch -c master`, `git switch -c HEAD` (protected/default target).
3. The hook **DENIES** `git switch -C <branch>` (force-create/reset is not the allowed shape).
4. The hook **DENIES** `git switch -c <branch>` with any additional flag (`--force`, `--detach`,
   `--discard-changes`, etc.) or any additional positional (a start-point).
5. The hook **DENIES** quoted / obfuscated bypasses of the above (`git switch -c "main"`, `git switch -c ma\in`,
   `git switch -c "-c"`-style spellings) via the existing de-quote path.
6. `git switch <existing-branch>` keeps its current Class-1 ALLOW; no Class-1/2/3 allow and no Class-4 deny regresses.
7. A **runner** (`forge-*`) agent still gets **no** branch creation (`git switch -c …` → DENY; L3 unchanged).
8. The proven **deny engine is untouched** — complex/dynamic/obfuscated `switch -c` forms still DENY, and every
   pre-existing self-check case still passes.
9. New, **non-tautological self-check cases** cover criteria 1–8 and were genuinely **RED before** the change.
10. `node .claude/hooks/forge-permissions.selfcheck.mjs` passes (incl. the new cases); `pnpm test` and `pnpm
    typecheck` pass; scope guard clean (only `.claude/hooks/**` changed).

## Verification

- RED→GREEN evidence on the self-check; full self-check + `pnpm test` + `pnpm typecheck`; scope guard clean.
- Governed two-pass verifiers review the diff for the invariant (additive `switch -c` allow only; safe-branch shape
  filter applied; deny engine + Tier-3 set + runner L3 untouched) and additivity; PM judges → commit-gate.
- **Install note:** `.claude/hooks/**` is not part of `verify-install` (which covers `commands/`+`agents/`), so no
  install refresh is required for this ticket.

## Ratified decisions (Sr PM — Dan, 2026-06-23)

1. **Scope this sprint = Tier 1 only** (safe feature-branch creation). The `ask` spike and commit-ASK are separate,
   later units.
2. **Reuse `isSafeFeatureBranch`** for the `-c` target; never a protected/default branch; no new shape logic.
3. **`-C` / extra flags / start-point / unsafe shapes stay DENY; runner L3 unchanged; deny engine untouched.**
4. **No `.claude/settings.json` change, no README change** in this ticket (README permissions wording is a separate
   follow-up).
