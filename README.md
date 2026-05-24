# ForgeGate

> Deterministic, human-gated orchestration for Claude Code one-ticket engineering workflows.

**ForgeGate** is a deterministic, human-gated orchestration layer for Claude Code — it structures one
ticket of agent work, enforces path fences and verification, and stops at the commit gate. It is **not**
a fully autonomous engineering system, and v1 makes no claim to be.

**Forge Core** is the deterministic CLI engine underneath: **CLI-first and runtime-agnostic**, it runs
from a plain terminal and is consumed by Claude Code command wrappers, never the other way around.
(The package is `forge-core` and the binary is `forge`.)

> Design notes: [`docs/one-ticket-orchestration-design.md`](docs/one-ticket-orchestration-design.md) · [`docs/forge-run-ticket-design.md`](docs/forge-run-ticket-design.md)

## Status

What exists today, exercised end-to-end on a real one-ticket run:

- **Read-only validator + CLI** — `load → integrity → readiness → report`, exposed as
  `validateContract(epicPath): ValidationReport` and wrapped by the `forge` CLI. No source or epic files
  are modified during validation.
- **Importer** — normalizes a legacy (pre-Forge) sprint folder into the canonical contract.
- **Deterministic run-packet generation** — `forge packets` pins `repo_root`, cwd discipline, allowed/
  forbidden/protected paths, branch, and the per-role dispatch context for the selected ticket.
- **Dispatch adapter** — `forge dispatch <role>` builds each agent's dispatch spec (registered subagent
  or injected-charter fallback) from the packets; nothing is improvised.
- **Agent-output validation** — `forge parse-agent <role>` validates every agent's structured YAML against
  the role schema; malformed output is rejected, never repaired.
- **Deterministic PM input assembly** — `forge dispatch pm` re-validates the upstream agent outputs and the
  orchestrator's confirmed facts, then embeds the validated structures in the PM prompt verbatim.
- **The packaged `/forge-run-ticket` one-ticket loop** — the interactive orchestration entry point
  (engineer → independent verify → verifiers → PM), which stops at the commit gate. It has driven a real
  ticket end-to-end.

What is **not** built yet: hooks, status write-back, journal append, local commit-at-gate automation, and a
multi-ticket loop. v1 always stops at the commit gate for a human.

## Quickstart

Minimal happy path against an existing epic (`docs/epics/forge-self-improvement` or `sandbox-epic`):

```bash
pnpm install
pnpm build
node dist/cli.js validate docs/epics/forge-self-improvement     # read-only contract validation
node dist/cli.js run docs/epics/forge-self-improvement --dry-run # preview the next ready ticket
```

For the full orchestration loop, run `/forge-run-ticket <epic-path>` **inside Claude Code** — that is the
interactive entry point that dispatches the agents and pauses at the commit gate. The CLI subcommands above
are read-only and safe to run from a plain terminal.

## Commands

```
forge validate <epic-path>          Validate a contract. Prints a human-readable summary and
                                     writes .forge/validation-report.json. Exit 0 if ok, 1 if not.
forge validate <epic-path> --json   Print the full ValidationReport as JSON. Writes no artifact.

forge status <epic-path>            Summarize epic id, sprint ids, ticket counts, finding totals.
                                     Exit 0 normally; exit 1 only if the contract cannot load at all.

forge run <epic-path> --dry-run     Execution preview (read-only): validate, then report the next ready
                                     ticket, dependency reasoning, paths, verify commands, effective gate,
                                     proposed branch, and the agent chain that WOULD run. Changes nothing.
                                     Exit 0 if a ticket is ready, 1 if blocked. (--json for the raw report.)
                                     A live run (without --dry-run) is not implemented yet.

forge import --from-existing <legacy-sprint-path> --out <epic-root> --dry-run
                                     Plan an import: list canonical target files and flag ambiguity.
                                     Read-only; writes nothing.
forge import --from-existing <legacy-sprint-path> --out <epic-root>
                                     Live import: generate the canonical contract and validate it.
forge import ... --json              Emit the import plan / result as JSON.

forge packets <epic-path>           Generate the deterministic run-packet set for the next ready ticket
                                     (repo_root, cwd discipline, paths, branch, per-role dispatch context)
                                     as JSON. Exit 1 (with blockedReasons) if no ticket is ready.

forge dispatch <role> <epic-path>   Build one agent's dispatch spec ({role, subagent_type, mode, prompt})
                                     as JSON for role engineer | semantic-verifier | scope-verifier | pm.
forge dispatch pm <epic-path> --engineer-output <f> --semantic-output <f> --scope-output <f> --facts <f.json>
                                     PM input assembly: re-validate the three agent outputs and the
                                     orchestrator-confirmed facts (.json), then emit the PM dispatch with
                                     the validated structures embedded. Any invalid input → ok:false, exit 1.

forge parse-agent <role> (--file <path> | --stdin)
                                     Validate an agent's structured YAML output against the role schema.
                                     Exit 0 if valid, 1 if not. Roles: engineer | semantic-verifier |
                                     scope-verifier | pm.
```

### Importing legacy sprints

`forge import` normalizes a legacy (pre-Forge) sprint folder into the canonical contract.

- **Overwrite policy:** the output directory must be empty or non-existent. A non-empty `--out`
  is refused with `IMPORT_OUTPUT_EXISTS`. There is **no `--force`** in v1.
- The legacy source folder is never modified. Prose is preserved verbatim in the generated
  `SPRINT.md`, `DECISIONS.md`, and ticket bodies. A self-contained `.forge/import-report.json`
  is written.
- **Import-draft semantics:** when a required canonical field (e.g. `risk`, `change_class`,
  `blast_radius`) is ambiguous in the legacy source, the importer writes a `TODO` placeholder
  **rather than inventing a value**. Such a contract is a *human-completion draft*: `validateContract`
  intentionally flags those fields, the command prints "requires human completion before execution,"
  and exits non-zero. Complete the `TODO`s, then `forge validate` until the contract is clean.

### Exit codes

| Code | Meaning |
|------|---------|
| `0`  | success (`validate`: report ok; `status`: contract loaded; `run --dry-run`: ticket ready; `parse-agent`: valid) |
| `1`  | validation/status/parse failure (findings, contract could not load, blocked dry-run, invalid agent output, or an artifact-write failure) |
| `2`  | usage error (missing path, unknown flag) |

### Artifact behavior

- `forge validate <epic-path>` (default mode) writes `.forge/validation-report.json` under the epic path.
- `forge validate <epic-path> --json` prints JSON to stdout and writes **no** artifact.
- `.forge/` is gitignored. If the artifact write fails, validation output is still printed, a clear
  message goes to stderr, and the process exits non-zero.

## Install & setup

```bash
pnpm install            # install dependencies
pnpm build              # emit dist/
pnpm install-commands   # install commands/*.md → ~/.claude/commands/ and agents/*.md → ~/.claude/agents/
```

### Develop

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build                                  # emit dist/
pnpm forge validate <epic-path>             # dev run via tsx
node dist/cli.js validate <epic-path>       # run the built binary
```

### CLI resolver and environment

Each Claude Code wrapper invokes a single deterministic command —
`node "${FORGE_REPO}/scripts/run-forge-cli.mjs" <subcommand> $ARGUMENTS` — so the tool
allowlist (`Bash(node:*)`) matches cleanly without a compound shell snippet. The resolver script picks the
CLI in this order:

1. **`$FORGE_BIN`** — overrides `PATH`; set it to pin a specific built binary.
2. **`forge` on `PATH`** — e.g. after `pnpm build` then `pnpm link --global`.
3. **local-dev `pnpm -C <repo> forge`** — the tsx-based dev fallback.

`FORGE_REPO` is the path to your forge-gate checkout; **set it** (or `pnpm link --global` the CLI so
`forge` is on `PATH`) so the wrappers can locate the CLI.

## Claude Code wrappers (convenience surface)

**Forge Core (this CLI) is the source of truth.** The Claude Code slash commands are *thin* wrappers
that shell out to the `forge` CLI and summarize its output — they add no logic, never edit source, and
never invent metadata. The one exception is `/forge-run-ticket`, which is the orchestrator: it is still
mechanical (it dispatches agents, runs the deterministic CLI, does git, and pauses at gates) and makes no
code judgments of its own.

| Command | Runs |
|---|---|
| `/forge-validate <epic-path>` | `forge validate <epic-path>` |
| `/forge-status <epic-path>` | `forge status <epic-path>` |
| `/forge-import --from-existing <legacy> --out <epic-root> [--dry-run]` | `forge import ...` |
| `/forge-run-dry-run <epic-path>` | `forge run <epic-path> --dry-run` |
| `/forge-run-ticket <epic-path>` | Orchestrates ONE ticket (engineer → verifiers → PM) via the CLI; stops at the commit gate |

Canonical wrapper sources live in `commands/`; charters live in `agents/`. Install both with
`pnpm install-commands` (see **Install & setup** above for binary resolution via `FORGE_BIN` / `FORGE_REPO`).

### Wrapper smoke checklist (manual, inside Claude Code)

Install once, then run the slash commands **inside Claude Code** (they are not shell commands; set
`FORGE_REPO` in the environment if `forge` is not linked globally):

```bash
pnpm install-commands
# then, inside Claude Code (with FORGE_REPO exported if forge is not on PATH):
/forge-validate src/validate/__fixtures__/valid-epic
/forge-run-dry-run src/validate/__fixtures__/valid-epic
```

Expected:
- `/forge-validate <fixture>` → `OK`/`FAILED` + findings.
- `/forge-status <fixture>` → epic / sprint ids / ticket counts.
- `/forge-import --from-existing <legacy> --out <tmp> --dry-run` → planned target files + ambiguity findings; nothing written.
- `/forge-run-dry-run <fixture>` → next ready ticket + "No files changed"; an invalid contract shows `BLOCKED`.
- `/forge-run-ticket <epic>` → one-ticket loop that stops at the commit gate (commits nothing).
- No wrapper edits source or contract files.

## The v1 safety model

Forge v1 is intentionally conservative and human-gated:

- **One ticket per run.** `/forge-run-ticket` selects and runs exactly one ready ticket.
- **Stops at the commit gate.** On PASS it prints the handoff (changed files, verification summary, PM
  decision, a *proposed* status transition, a suggested commit message and `git add`/`git commit`) and
  **stops**. It never commits.
- **No auto push / PR / merge.** None of these are automated in v1.
- **No status write-back.** The contract's ticket status is never modified by a run.
- **No journal write.** `JOURNAL.md` / `DECISIONS.md` are append-only and owned by the orchestrator/human,
  not written by a run.
- **The engineer edits only `allowed_paths`.** The diff is independently scope-checked against the packet's
  allowed/forbidden/protected paths.
- **`.forge/` runtime artifacts are gitignored** (`active-ticket.json`, `lock.json`, `run-report.json`, the
  captured agent outputs, the validation/import reports).
- **`lock.json` guards concurrency.** A run refuses to start if a lock is present; the human is shown the
  recovery path rather than having it silently overwritten.
- **Failed runs preserve evidence.** A failure writes `.forge/run-report.json`, leaves the branch and working
  tree intact, and produces a recovery brief with *suggested* (not executed) cleanup commands.

### Not autonomous / not magic

Forge **structures** Claude Code work and enforces discipline — path fences, independent verification,
schema-validated agent I/O, and a hard stop at the commit gate. It does **not** take over responsibility:
the human stays accountable for what gets committed, pushed, or merged. v1 always stops at the commit gate.
There are no claims here of full autonomy or unsupervised readiness.

## Agent charters

The four Forge subagent roles are defined as Claude Code subagent charters in `agents/` (installed to
`~/.claude/agents/` by `pnpm install-commands`). They are **declarations of the human/agent contract** and
are now dispatched live by `/forge-run-ticket`.

| Charter | Role | Edits code? | Decides? |
|---|---|---|---|
| `forge-engineer` | Implements one ticket, TDD, within its allowed paths | yes (allowed paths only) | no |
| `forge-semantic-verifier` | Verifies acceptance is genuinely met vs repo reality | no (read-only) | verdict only |
| `forge-scope-verifier` | Verifies the diff stays inside the path fences | no (read-only) | verdict only |
| `forge-pm` | Synthesizes outputs, decides PASS / CORRECT / ESCALATE | no | yes |

Each charter specifies its role, inputs, the governance docs it must read, what it must **not** do, a
**structured YAML output schema**, escalation behavior, and **anti-theater rules** (verifiers must cite concrete
evidence; "looks good" is invalid; the PM may not PASS over a REJECT without a recorded override + human escalation).

**Dispatch model.** `forge dispatch <role>` builds each agent's dispatch spec deterministically. When the
harness exposes registered `forge-<role>` subagent types, the dispatch uses that subagent type directly
(`mode: registered`) with its charter as the system prompt. When those types are unavailable, it falls back
to the **general-purpose** agent with the tracked charter body injected verbatim (`mode: injected-charter`) —
never an improvised prompt. Either way the prompt pins `repo_root` and the cwd-discipline statements.

## Current maturity & limitations

**Current maturity.** Usable locally. Proven on the `sandbox-epic` and on one real Forge self-improvement
ticket (T01) driven end-to-end. It is **not yet** published or released as a polished public package, and the
following are **not yet** wired: auto push/PR/merge, status write-back, and journal hooks.

**Limitations.**
- Registered `forge-*` subagent types may be unavailable in some harnesses; the deterministic
  injected-charter fallback handles that case (general-purpose agent + verbatim charter body).
- v1 is intentionally conservative and human-gated, and always stops at the commit gate.
- No autonomy or unsupervised-readiness claims are made anywhere in this document.

## Principles

- The core is real, typed, unit-tested code — never prompt logic.
- `forge validate` is a hard precondition for any future execution and is **read-only**.
- One responsibility per module (`schema`, `validate/{load,integrity,readiness,findings}`, `cli`).
- Findings use a single stable shape (`ValidationFinding`) with canonical codes and epic-relative paths.
