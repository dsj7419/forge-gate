---
schema_version: 1
id: T01
title: Add optional parse-agent --out for Core-owned role-output persistence
kind: green
risk: medium
change_class: feature
blast_radius: module
status: pending
depends_on: []
blocks:
  - T02
allowed_paths:
  - src/cli/run.ts
  - src/cli/run.test.ts
  - docs/epics/forge-core-owned-role-output-persistence/**
gate: pr
gate_override: false
verifier: two-pass
verify_commands:
  - pnpm test
  - pnpm typecheck
forbidden_paths:
  - workflows/forge-run-ticket.workflow.js
  - scripts/**
  - src/workflows/**
  - src/agents/**
  - src/orchestrator/**
  - src/repo/**
  - src/guard/**
  - src/run-report/**
  - src/schema/**
  - src/validate/**
  - src/importer/**
  - src/install/**
  - src/fs/**
  - src/cli/active-ticket.ts
  - src/cli.ts
  - src/index.ts
  - agents/**
  - commands/**
  - .claude/**
  - vitest.config.ts
  - tsconfig.json
  - package.json
  - pnpm-lock.yaml
  - README.md
  - docs/governance/**
  - "**/.forge/**"
  - sandbox-epic/**
  - pilot-local/**
  - templates/**
  - .github/**
---

# T01 — Add optional `parse-agent --out` for Core-owned role-output persistence

## Scope

Add an **optional, backward-compatible** `--out <path>` flag to `forge parse-agent <role>`. When supplied, after a
**successful** validation Core writes the validated canonical JSON to `<path>` via its own `fs` (the
`active-ticket --out` shape), with `.forge` path containment. When omitted, `parse-agent` behaves **exactly as
today** (validate + echo, no write). This is the additive Core surface only — **no workflow change** (that is T02).

## Core invariant (the reason this ticket exists)

> Core may write a role-output artifact **only** after that output passes the role's authoritative schema
> validation (and, for `pm`, the pinned `--expected-decision-id` cross-check). On any validation failure, **nothing
> is written**. The written bytes are the **validated canonical object**, never the raw input. The `--out` path may
> never escape a `.forge/` directory. Core never repairs.

## Discovery findings (inspected, not assumed; line numbers at the contract baseline `6cd0440`)

1. **`parse-agent` already validates authoritatively.** `src/cli/run.ts:309-363` routes the structured modes
   (`--json-file`/`--json-stdin`) through `ingestAgentOutput` → `validateRole` (`src/agents/ingest.ts:37-50`), and
   the YAML modes (`--file`/`--stdin`) through `parseAgentOutput`. Both return the same `ParseResult`. Malformed
   JSON / invalid shape → `AGENT_OUTPUT_INVALID`, exit 1, **never repaired**. `parse-agent` has **no `--out` today**
   — it validates and echoes; it does not persist.
2. **The PM decision-id cross-check already exists.** `run.ts:370-376`: for `role === "pm"`, after a successful
   parse, the emitted `decision_id` must equal `--expected-decision-id`; a mismatch fails before any further action.
3. **The Core-owned write precedent exists.** `active-ticket --out` (`run.ts:271-288`) resolves the path,
   `fs.mkdirSync(dirname, {recursive:true})`, `fs.writeFileSync(out, json)` — Core writes byte-exact via its own
   `fs`. **It has NO containment guard today** (a latent gap this ticket does not inherit — see below).
4. **The containment precedent exists in run-report.** `src/run-report/cli.ts:215-223` rejects an `--out` that does
   not resolve strictly inside the epic `.forge/` with `OUT_PATH_OUTSIDE_FORGE` (resolved-path containment, not
   string-prefix). `parse-agent` differs in one way: **it takes no epic argument** (see Open implementation
   decisions for the boundary definition).

## Required command shape

```
forge parse-agent <role> (--json-stdin | --json-file <p> | --stdin | --file <p>) [--out <path>] \
                         [--expected-decision-id <D-NNN>  (pm only)]
```

- `--out` is **optional and additive**. Without it: today's behavior, byte-identical. With it: on a successful
  validation, Core writes the validated canonical JSON to `<path>` and still prints the result; on **any**
  validation/cross-check failure it writes **nothing** and exits non-zero.
- The persisted file is the **validated canonical object** serialized by Core, not the raw input bytes.
- `--out` is valid for all four input modes (the structured modes are what the workflow will use in T02; the YAML
  modes get `--out` for free and uniformity).

## Validation and failure semantics

- **Validation precedes any write.** Reuse the existing `ingestAgentOutput`/`validateRole` (and the `pm`
  `--expected-decision-id` cross-check). On failure: **no file written**, exit 1, the existing failure shape
  (`AGENT_OUTPUT_INVALID` / the decision-id mismatch result). Core never repairs.
- **Path containment.** `--out` must resolve strictly inside a `.forge/` directory; otherwise a typed
  `OUT_PATH_OUTSIDE_FORGE` failure, exit non-zero, **no write**.
- **Unknown role.** Usage error (exit 2), no write (existing behavior).
- **Write failure (fs).** Error message + exit 1 (as `active-ticket --out`).

## AI Instructions

- TDD: RED first in `src/cli/run.test.ts` for the new `--out` behavior (write-on-success, no-write-on-failure,
  containment, decision-id-mismatch-no-write, backward-compat without `--out`), then the minimal implementation in
  the `parse-agent` branch of `src/cli/run.ts`.
- Keep it **additive and surgical**: the existing `parse-agent` behavior without `--out` stays byte-identical and its
  tests stay green unmodified. Add `--out` to the `parse-agent` flag set.
- Implement the write by mirroring `active-ticket --out` (Core `fs` write of the **validated** object), **plus** the
  `.forge` containment guard `active-ticket --out` lacks. Do **not** modify `active-ticket` or `run-report`. If the
  containment guard cannot be added without touching `src/run-report/**` or `src/fs/**`, **stop and report** (a
  re-scope) — prefer an inline/private check within `run.ts`.
- No schema change. No workflow change. No permission change. Do not touch any forbidden path.
- `pnpm test` and `pnpm typecheck` green; scope guard clean (only `allowed_paths` change).

## Acceptance Criteria

1. `--out` is **optional and backward-compatible** — `parse-agent` without `--out` is byte-identical to today.
2. `--out` writes the artifact **only after** a successful validation.
3. **Malformed/invalid** output writes **nothing** and exits non-zero (`AGENT_OUTPUT_INVALID`).
4. **Unknown role** writes nothing (usage error, exit 2).
5. **PM `--expected-decision-id` mismatch** writes nothing and exits non-zero.
6. The `--out` path must resolve **strictly inside a `.forge/` directory**.
7. An `--out` path that escapes `.forge/` fails closed with a typed `OUT_PATH_OUTSIDE_FORGE` and **writes nothing**.
8. The persisted file is the **validated canonical JSON**, not the raw input bytes.
9. **No schema changes; no workflow changes; no permission changes.**
10. Tests are **non-tautological**, genuinely **RED before** the implementation, and exercise real CLI behavior.
11. `pnpm test` and `pnpm typecheck` pass; scope guard clean (only `allowed_paths` change).

## Required tests

1. `parse-agent engineer --json-stdin --out <p>` writes canonical valid **engineer** output.
2. `parse-agent semantic-verifier --json-stdin --out <p>` writes canonical valid **semantic-verifier** output.
3. `parse-agent scope-verifier --json-stdin --out <p>` writes canonical valid **scope-verifier** output.
4. `parse-agent pm --json-stdin --out <p> --expected-decision-id D-001` writes canonical valid **PM** output with a
   matching `decision_id`.
5. Invalid output exits non-zero and **writes no file**.
6. PM `decision_id` mismatch exits non-zero and **writes no file**.
7. `--out` path outside a `.forge/` directory exits non-zero (`OUT_PATH_OUTSIDE_FORGE`) and **writes no file**.
8. Legacy `parse-agent` behavior **without `--out`** remains unchanged.

## Verification

- RED→GREEN evidence; full `pnpm test` / `pnpm typecheck`.
- Governed two-pass verifiers review the diff for the invariant (validate-before-write, no-write-on-failure,
  containment, canonical-object persistence, additivity) and additivity; PM judges.
- **No live workflow proof is required for T01** (it is pure Core, fully unit-testable). The classifier-behavior
  question belongs to T02's merge gate.
- **No install refresh** post-merge: none of `commands/**`, `agents/**`, or `README.md` is touched.

## Ratified decisions (PM — Dan, 2026-06-17)

1. **Command surface → extend `parse-agent` with optional `--out`** (no separate `role-output persist` command).
2. **Input mode → the workflow will use `--json-stdin`** (T02); `--out` is valid for all input modes here.
3. **Scope (epic) → all four role outputs**; T01 provides the surface for all four.
4. **No post-write read-back validation** — Core writes the validated in-memory object.
5. **No schema change; no workflow change** in T01.

## Ratified implementation decisions (PM — Dan, 2026-06-17)

1. **Containment boundary → RATIFIED: `--out` must resolve strictly inside a `.forge/` directory segment.** Require
   **robust path normalization and fail-closed traversal refusal** (a crafted `…/.forge/../../outside.json` must be
   refused via resolved-path containment, not string-prefix). **Do NOT add `--repo-root` or epic-root plumbing** —
   keep T01 small; revisit only if implementation discovers the `.forge` segment check is insufficient (and then
   stop and report, do not broaden silently).
2. **Failure code → RATIFIED: `OUT_PATH_OUTSIDE_FORGE`.**
3. **Containment helper → implementation choice left open (PM).** Prefer a minimal, safe inline/private check in
   `src/cli/run.ts`; extract a shared helper **only if it does not broaden scope** (a shared helper that pulls in
   `src/run-report/**` or `src/fs/**` is a re-scope — stop and report).
