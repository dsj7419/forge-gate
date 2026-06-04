# Epic — Cross-run concurrency foundation

## Why

ForgeGate's single-run provenance seams (gate, decision-id) are closed, but nothing serializes two runs that
target the same repo. The discovery (`docs/cross-run-concurrency-discovery.md`, landed via PR #32) found three
load-bearing facts in `src/**`:

- `appendDecision` (`src/orchestrator/decisions-ledger.ts`) is a read-modify-write whose IO seam explicitly leaves
  atomicity to the caller — so two concurrent runs can read the same ledger snapshot, compute the same next
  `decision_id`, and both write, producing a duplicate or a lost update.
- Every `.forge/**` artifact is a fixed per-epic filename written with a truncating `fs.writeFileSync`
  (last-writer-wins), so concurrent runs can clobber each other's evidence.
- The only mutual exclusion — `lock.json` — exists solely as a check-then-write convention in the Markdown
  orchestrator (`commands/forge-run-ticket.md`); Core owns no lock, no atomic exclusive-create, and no atomic
  rename, and the workflow-backed runner may not honor the convention at all.

Substrate-prevent is unavailable here (the harness offers no cross-run lease), so Core must own a real lock and an
atomic ledger append. This epic closes the two most dangerous invariants first: **exclusive run ownership** and
**non-duplicating / non-clobbering PM decisions**.

## Goal

Give Core a real, typed, unit-tested epic-level lock primitive (atomic exclusive create, fail-closed contention,
owner-checked release, reportable-but-never-auto-stolen stale detection) and make the decisions-ledger append
atomic so a `decision_id` can never duplicate or clobber another, even if the lock is bypassed.

## Sprints

- `sprint-01-concurrency-foundation` — one ticket: the Core lock primitive plus the atomic/CAS ledger append.

## Out of scope (this epic)

- Evidence-write ownership across `run-report.json` / `active-ticket.json` / `orchestrator-facts.json`.
- Orchestrator command wiring (`commands/forge-run-ticket.md`) and workflow wiring (`workflows/**`).
- Stale-lock recovery UX beyond safe detection and reporting.
- Per-run worktrees and the full multi-worktree shared-state architecture.
- Any relaxation of the human-gate thesis.

## Deferred design note (ratified for this epic)

The lock and ledger state are anchored to the canonical repo-root / canonical epic `.forge` for this first
implementation. **Worktree isolation remains unsafe for shared decision provenance** until ForgeGate has a stable
shared-state location that does not fragment per worktree (a separate worktree carries its own
`.forge/decisions-ledger.json`, so two isolated runs would each start an independent ledger and both mint `D-001`).
Solving that location is explicitly later work.
