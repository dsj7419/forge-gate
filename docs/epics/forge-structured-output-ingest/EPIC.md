# ForgeGate — structured-output agent ingest (zod/v4 + source-agnostic adapter)

Lay the Core foundation for the harness-era agent-output path: let ForgeGate accept either a **structured
object** (from the future workflow `agent({schema})` path) or **YAML text** (the existing slash-command
fallback), and send **both through the same authoritative Zod validation**. This is Phase 1a+1b of the
plan in `docs/agent-output-ingest-adapter-design.md`; it builds the foundation, it does not build the
workflow runner.

- **Goal:** port the four role-output schemas to `zod/v4` (so they can also emit JSON Schema) and add a
  source-agnostic ingest adapter, without weakening the YAML path or changing what Core enforces. The
  Phase 0 spike proved structured output constrains *shape* only — Zod refinements, string-length,
  `decision_id` pattern, and numeric bounds are not representable in JSON Schema, so **Core Zod
  re-validation stays authoritative on both paths**.
- **Non-goals (this epic):** the workflow runner; run-report source tracking (Phase 1c — `src/run-report/**`
  is untouched here); any package/lockfile change (`zod/v4` resolves from the installed version, proven in
  discovery); charter or command edits; `run_id`/`attempt_id`; status write-back; journal automation;
  hooks; `forge doctor`/`init-target`; auto commit/push/PR/merge; multi-ticket behavior.
- **Constraints:** human-gated; one ticket; the run stops at the commit gate; the engineer edits only the
  ticket's `allowed_paths`. `src/schema/enums.ts` stays Zod 3 (shared by contract schemas); the role
  schemas remain the **single source of truth** (no parallel schemas).

## Claude Code Substrate Review

- **Dynamic workflows** will consume the structured-output path later (Phase 2 runner) — execution
  substrate, not the trust boundary.
- **Structured output** is the preferred future agent-output delivery path; this epic builds the ingest
  side of it.
- **Forge Core** owns validation and provenance — the ingest adapter, the role schemas, and the
  authoritative Zod re-validation stay in Core. Structured output reduces formatting fragility; it does
  not replace Zod validation.
- **YAML** remains the fallback for the Markdown slash-command path; it is not weakened.
- **Subagents / agent types** (incl. `forge-core-runner`) belong to Phase 2.
- **Hooks** and **Agent SDK / headless** remain deferred.

## Sprints

- `sprint-01-structured-ingest` — port role schemas to `zod/v4` + local primitives; add the
  `src/agents/ingest.ts` source-agnostic adapter; add `forge parse-agent --json-file/--json-stdin`
  structured modes and a `forge agent-schema <role>` JSON-Schema emitter; preserve the YAML path and the
  PM decision-id cross-check (T01).

> Self-run note: this epic edits ForgeGate's own Core agent-output validator, so its ticket is driven with
> a **frozen build** (`pnpm build` then run from `dist/`) so a run cannot mutate the tool executing it.
