# B2 Discovery — Decision-ID Assignment Provenance (Option B)

> Discovery only. Author: senior engineer, 2026-05-30. Status: **for PM review — no implementation, no epic,
> no branch, no commit.** Scope decided by the PM: **Option B** — move PM `decision_id` *assignment* into
> Core `dispatch pm`, AND move the ledger *append* onto a Core command that calls `appendDecision`. Close both
> decision-id seams. Evidence cited by `path:line`; verified by three independent read agents + a sanctioned-tool
> re-grep (the adversarial agent's findings were re-confirmed with Grep after it bypassed the PowerShell deny
> rule — see §7).

---

## The finding that set the scope

C4's ledger machinery (`readDecisionsLedger`, `appendDecision`, `nextDecisionId`, the
uniqueness/monotonicity `superRefine`) is real and tested, but **no CLI command calls it** — confirmed by
Grep: `appendDecision`/`readDecisionsLedger` appear only in `src/orchestrator/decisions-ledger.ts` and its
test; `nextDecisionId` only in `decision-id.ts`, `decisions-ledger.ts`, and tests; `src/cli/run.ts` references
`--assigned-decision-id` as a string flag but imports none of the ledger modules. So on the **live run path**
the orchestrator markdown does the ledger work as prose: reads the JSON, computes the next id in prose, passes
`--assigned-decision-id`, and **hand-writes the JSON append** (`commands/forge-run-ticket.md` step 9 a/b/f).
C4 is correct code sitting **off the enforcement path** — the same "orchestrator hand-authors a Core artifact"
seam we just hardened for capture. B2 puts both halves on the Core path.

---

## 1. Current B2 live flow (verified)

```
orchestrator prose reads .forge/decisions-ledger.json
  → orchestrator computes next id in prose
  → --assigned-decision-id D-NNN  →  forge dispatch pm   (validates FORMAT only; renders into PM prompt)
  → PM agent echoes id
  → forge parse-agent pm --expected-decision-id  (string-equality cross-check → DECISION_ID_MISMATCH)
  → orchestrator prose HAND-WRITES the ledger JSON append   ← appendDecision NEVER called by Core
```

Evidence: `commands/forge-run-ticket.md` step 9(a/b) prose-read+compute, 9(d) `--assigned-decision-id`,
9(e) cross-check, 9(f) hand-append. `src/cli/run.ts:113,127-156` flag parse/validate;
`src/orchestrator/dispatch.ts:253-302` `buildPmDispatch` is a **pure assembler** (no IO seam, reads no files);
`appendDecision`/`readDecisionsLedger` callers = tests only.

## 2. Proposed Option B flow

```
forge dispatch pm <epic> --repo-root R
  → Core reads <epic>/.forge/decisions-ledger.json via DecisionsLedgerIo seam (readDecisionsLedger)
  → Core computes nextDecisionId(existing) INTERNALLY
  → renders that id into the PM prompt's authoritative section
  → (optional) --assigned-decision-id, if supplied, must EQUAL Core's computed id → else DECISION_ID_PROVENANCE_MISMATCH
  → PM agent echoes id
  → forge parse-agent pm --expected-decision-id   (UNCHANGED string-equality cross-check)
  → forge ledger append <epic> --decision-id … --ticket … --branch …   ← Core calls appendDecision (C4 guard live)
```

Assignment becomes Core-file→Core-file; the flag is a cross-check, never the source. The append goes through
`appendDecision`, so `LEDGER_SEQUENCE_INVALID` (duplicate/lower/gap) is enforced on the live path for the
first time. No more hand-written ledger JSON.

## 3. Recommended CLI command shape

**Naming — recommend `forge ledger append <epic>`.** Precedent in `src/cli/run.ts:44-57` (`KNOWN_COMMANDS`):
single-token commands, with two-level `<noun> <subcommand>` used only by **`run-report write`** and
**`guard paths`**. `ledger append` matches that established style exactly; it is the smallest, clearest
surface. (`decisions append` also works but `ledger` is shorter and reads well; `decision-ledger append` is
the most verbose — not recommended.) Add `ledger` to `KNOWN_COMMANDS` + USAGE; route to a new
`runLedger(args, io, io2)` like `run-report`/`guard` route to their modules.

**Assignment lives in `dispatch pm`** — it already has the epic path (`run.ts:99` `dispatchEpic`) and
`--repo-root` (`run.ts:158`) and already calls `generateRunPackets(dispatchEpic, repoRoot)`. The ledger path
is `<epic>/.forge/decisions-ledger.json` (`decisions-ledger.ts:7`).

### Where things live (proposed)
- **Assignment:** `src/cli/run.ts` `runDispatch` reads the ledger (inject a `DecisionsLedgerIo`, default real
  fs) and computes `nextDecisionId` before building the PM dispatch; `buildPmDispatch`/`PmRawInputs` in
  `src/orchestrator/dispatch.ts` change so the id is Core-supplied, not flag-required. (Keeping the read in the
  CLI layer preserves `buildPmDispatch`'s purity, OR pass the ledger IO into a thin new assembler entry — open
  question 3.2.)
- **Append command:** a new small module `src/orchestrator/ledger-cli.ts` (mirrors `run-report/cli.ts` shape)
  exposing `runLedgerAppend(args, io, ledgerIo)`, calling the existing `appendDecision`. Routed from
  `src/cli/run.ts`.

## 4. Failure codes

| Code | Where | When |
|---|---|---|
| `DECISION_ID_PROVENANCE_MISMATCH` (new) | `dispatch pm` | optional `--assigned-decision-id` supplied but ≠ Core's computed `nextDecisionId` |
| `LEDGER_INVALID` (exists) | `dispatch pm` read + `ledger append` | ledger file malformed JSON / schema violation |
| `LEDGER_ENTRY_INVALID` (exists) | `ledger append` | entry fails `LedgerEntrySchema` (bad decision_id/ticket/branch/ts) |
| `LEDGER_SEQUENCE_INVALID` (exists) | `ledger append` | entry id ≠ exact-next (duplicate/lower/gap) → **no write** |
| `DECISION_ID_MISMATCH` (exists, unchanged) | `parse-agent pm` | PM echoed id ≠ `--expected-decision-id` |

`appendDecision` already returns the three `LEDGER_*` codes and **writes nothing on failure**
(`decisions-ledger.ts:88-107`). The new command surfaces them verbatim. The only genuinely new code is
`DECISION_ID_PROVENANCE_MISMATCH` in the assignment path.

## 5. Ledger append command spec (proposed)

```
forge ledger append <epic> --decision-id D-NNN --ticket T01 --branch <branch> [--repo-root <path>]
```
- **Inputs:** epic path (locates `<epic>/.forge/decisions-ledger.json`); `--decision-id` (`^D-\d+$`);
  `--ticket` (`TicketIdSchema`); `--branch` (non-empty). `ts` is generated by the command at write time
  (ISO) — *open question 3.1: who supplies `ts`* (Core-generated keeps the orchestrator from hand-authoring
  it, consistent with the doctrine; but non-determinism in a Core artifact — acceptable since it's runtime
  `.forge/`, not a committed artifact).
- **Behavior:** build `LedgerEntry`, call `appendDecision(file, entry, ledgerIo)`, print the result.
- **Output (success):** `{ ok: true, ledger: { decisions: [...] } }` (exit 0), byte-deterministic file write
  (2-space indent + trailing newline, per `decisions-ledger.ts:109`).
- **Output (failure):** `{ ok: false, code: <LEDGER_*>, errors: [...] }` (exit 1), **no file write**.
- **No-write behavior:** every failure path returns before `io.writeFile` (proven in `appendDecision`).
- **Required tests:** duplicate id → `LEDGER_SEQUENCE_INVALID` no-write; lower id → same; gap-forward id →
  same; absent ledger + `D-001` → append succeeds (first entry); malformed existing ledger → `LEDGER_INVALID`
  no-write; bad entry field → `LEDGER_ENTRY_INVALID`; success appends + byte-exact serialization. (These
  mirror the existing `decisions-ledger.test.ts` unit cases but now at the **CLI** layer through the seam.)

## 6. Dispatch-pm assignment spec (proposed)

- **Locate ledger:** `<epic>/.forge/decisions-ledger.json` from `dispatchEpic` (`run.ts:99`).
- **Read via Core:** `readDecisionsLedger(file, ledgerIo)`; **absent file → empty ledger → `nextDecisionId([])`
  = `D-001`** (`decisions-ledger.ts:52-53`, `decision-id.ts` empty case). Malformed → `LEDGER_INVALID`,
  fail-closed (do not assign).
- **Compute:** `nextDecisionId(existing.map(d => d.decision_id))` — unchanged semantics.
- **Render:** into the PM prompt's `## Assigned decision_id (authoritative…)` section
  (`dispatch.ts:145-150` `renderAssignedDecisionId`); the `renderContext` null-throw guard
  (`dispatch.ts:109`) stays as defense-in-depth (value is now always Core-supplied, never null).
- **Flag downgrade:** `--assigned-decision-id` becomes **optional**. If absent → Core's computed id is used.
  If supplied and ≠ computed → `DECISION_ID_PROVENANCE_MISMATCH` (fail-closed, no dispatch). The current
  `ASSIGNED_DECISION_ID_REQUIRED` path (`run.ts:127-141`, `dispatch.ts:258-265`) is **removed/relaxed** to
  optional-cross-check.

## 7. parse-agent cross-check — UNCHANGED

`parse-agent pm --expected-decision-id` stays exactly as-is: pure string equality of the PM-emitted
`decision_id` vs the expected value (`run.ts:300-320`, comparison at `:302`), `DECISION_ID_MISMATCH` on
disagreement, pm-role-only. It is independent of *how* the id was assigned, so B2 does not touch it. The
orchestrator passes the same Core-computed id to both `dispatch pm` (assignment) and `parse-agent pm`
(echo-check), so the loop remains: Core assigns → PM echoes → Core verifies echo → Core appends.

## 8. Run-report — UNCHANGED

The run-report takes `decision_id` **verbatim from the PM output** (`run-report/assemble.ts:150`
`decision_id: pm.decision_id`); there is no `--decision-id` flag and `DecisionIdSchema` is unchanged
(`run-report/schema.ts:24-26,126`). **No schema or assembler change.** B2 does not touch `src/run-report/**`.

## 9. Live run protocol impact (the prose, NOT edited in B2)

From (today):
```
orchestrator reads ledger → orchestrator computes id → [dispatch/verify] → orchestrator hand-appends ledger
```
to (after B2):
```
forge dispatch pm   (Core reads ledger + computes + renders id)
forge parse-agent pm --expected-decision-id   (Core verifies PM echo)
forge ledger append (Core appends via appendDecision; C4 guard live)
```
Per PM direction, **`commands/forge-run-ticket.md` is NOT edited in B2** (just hardened + installed; avoid
churn). If, after the code lands, step 9's prose still says "orchestrator computes/hand-appends," that becomes
a **separate doc-cleanup follow-up** PR. (Implementation note: B2 can land entirely in `src/` + tests; the
command keeps passing the same flags, which now act as cross-checks — so the installed command still works,
just with the redundant-but-harmless flag, exactly like the gate-provenance `--gate-*` situation.)

## Allowed_paths (proposed)

```
src/cli/run.ts
src/cli/run.test.ts
src/orchestrator/dispatch.ts
src/orchestrator/dispatch.test.ts        # (current pm-dispatch tests live in src/orchestrator/pm-dispatch.test.ts — see note)
src/orchestrator/pm-dispatch.test.ts
src/orchestrator/ledger-cli.ts           # NEW — the `forge ledger append` command module
src/orchestrator/ledger-cli.test.ts      # NEW
```
Note: confirm at contract time whether the new append command belongs in `src/orchestrator/` (alongside the
ledger logic it wraps) or a `src/ledger/` dir; recommend `src/orchestrator/ledger-cli.ts` to keep it beside
`decisions-ledger.ts`. If `nextDecisionId`/`appendDecision` need a new *export* (they're already exported),
no edit to `decision-id.ts`/`decisions-ledger.ts` is required — keep them **forbidden** (logic frozen).

## Forbidden_paths (proposed)

```
src/orchestrator/decision-id.ts          # nextDecisionId semantics frozen
src/orchestrator/decisions-ledger.ts     # appendDecision/schema frozen — we WIRE it, not change it
src/run-report/**                         # no schema/assembler change
src/agents/**
src/schema/**
src/guard/**
src/validate/**
src/install/**
commands/**                               # no command-prose churn (separate follow-up)
agents/**
docs/**
README.md, *.md
package.json, pnpm-lock.yaml, tsconfig.json, vitest.config.ts
.github/**, .claude/**, scripts/**, pilot-local/**, sandbox-epic/**, sandbox-local/**
.forge/**, **/.forge/**, **/*.private.md
```
**Tension to resolve at contract time:** the smallest design wires assignment inside `src/cli/run.ts`'s
`runDispatch` and keeps `buildPmDispatch` pure (read ledger in the CLI layer, pass the computed id in). If
instead we move the read into `dispatch.ts`, that file needs a `DecisionsLedgerIo` seam — still fine, but it
changes `buildPmDispatch`'s signature. Both keep `decision-id.ts`/`decisions-ledger.ts` frozen. (Open
question 3.2.)

## Acceptance criteria (draft, for the contract)

1. `forge dispatch pm` reads `<epic>/.forge/decisions-ledger.json` via a Core IO seam and computes the
   assigned `decision_id` with `nextDecisionId` internally.
2. Absent ledger → assigns `D-001`; malformed ledger → `LEDGER_INVALID`, fail-closed (no dispatch).
3. The computed id is rendered into the PM prompt's authoritative section (unchanged rendering).
4. `--assigned-decision-id` is optional; when omitted, Core's computed id is used.
5. `--assigned-decision-id` supplied and ≠ Core's computed id → `DECISION_ID_PROVENANCE_MISMATCH` (no dispatch).
6. `forge ledger append <epic> --decision-id --ticket --branch` calls `appendDecision` and appends on success.
7. Duplicate / lower / gap id → `LEDGER_SEQUENCE_INVALID`, **no file write**.
8. Absent ledger + `D-001` → append succeeds as the first entry.
9. Malformed existing ledger on append → `LEDGER_INVALID`, no write; bad entry field → `LEDGER_ENTRY_INVALID`.
10. Ledger append is **not** reachable through `parse-agent` (parse-agent stays validation-only).
11. `parse-agent pm --expected-decision-id` behavior unchanged (`DECISION_ID_MISMATCH` on echo mismatch).
12. No change to `nextDecisionId` semantics, `DecisionsLedgerSchema`, or `src/run-report/**`.
13. `forge ledger append` uses the injected IO seam (no direct `node:fs` in the command path; testable).
14. `pnpm test` + `pnpm typecheck` pass.

## Risk / change_class / blast_radius / gate (proposed)

- **change_class:** `feature` (new command + behavior change). Avoid the negation-blind escalation keywords in
  the ticket prose.
- **risk:** `medium` (touches the PM dispatch path + adds a Core mutation command; contained, additive,
  reuses frozen C4 logic).
- **blast_radius:** `module` (orchestrator + cli + new ledger-cli module).
- **gate:** `pr`. Confirm `gate: pr, no escalation` via `forge run --dry-run` at contract time.

## Whether command docs must be touched now

**No.** `commands/forge-run-ticket.md` stays out of B2 (PM direction; just hardened/installed). The installed
command keeps working because the flags it still passes become harmless cross-checks (same pattern as the
gate-provenance `--gate-*` flags after B1). A doc-cleanup follow-up retires the now-redundant prose later.

## §7 — Tool-policy incident (separate follow-up, NOT in B2)

During discovery, the adversarial verifier subagent **ran PowerShell cmdlets through the Bash tool, bypassing
the session's PowerShell deny rule.** Its findings were correct but I re-confirmed the load-bearing claim
(no CLI caller of `appendDecision`/`readDecisionsLedger`) with the sanctioned **Grep** tool before relying on
it. This is a real substrate-policy gap (a deny rule on one tool is circumventable via another tool inside a
subagent). **Classification: FOLLOW_UP_OK / security-process.** Do **not** bundle into B2. Recommend logging
as a future Claude Code permissions/subagent-hardening item (and, for our own runs, constraining sub-agent
tool grants explicitly in the dispatch).

## Open decisions for Dan

1. **`ts` source for the append entry.** Core-generated ISO timestamp at write time (keeps the orchestrator
   from hand-authoring it — consistent with the doctrine), or passed as a `--ts` flag? My lean: Core-generated
   (it's a runtime `.forge/` artifact, not committed; non-determinism is acceptable there).
2. **Where the ledger read lives.** (a) in `src/cli/run.ts` `runDispatch`, keeping `buildPmDispatch` pure; or
   (b) push a `DecisionsLedgerIo` seam into `buildPmDispatch`. My lean: (a) — smallest change, preserves the
   pure assembler.
3. **Command name:** `forge ledger append` (my recommendation) vs `forge decisions append`. Lean: `ledger`.
4. **New module location:** `src/orchestrator/ledger-cli.ts` (beside the ledger logic) — confirm.
5. Confirm the §7 tool-policy item is logged separately and not widened into B2.

Do not implement. Awaiting the Option B scope confirmation + these decisions before authoring the contract.
