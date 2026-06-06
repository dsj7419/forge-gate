# Epic — Command lock wiring: make the epic lock the live cross-run serialization

## Why

T01 of `forge-cross-run-concurrency` (PR #34, `831e412`) shipped the Core epic-lock primitive
(`src/orchestrator/lock.ts`) and the atomic/CAS decisions-ledger append. T01 of `forge-lock-wiring`
(PR #36, `ab3fe75`) exposed that primitive as a deterministic, fail-closed CLI surface —
`forge lock acquire | release | status` — with the real `defaultLockIo` filesystem binding. **The lock is now
callable, but nothing calls it.**

The Markdown orchestrator (`commands/forge-run-ticket.md`) still manages its lock **by hand**, and that hand-rolled
path is exactly the race the primitive was built to close:

- **Step 1 (preflight)** does a non-atomic *check-then-act*: "Check `$EPIC/.forge/lock.json` — if present →
  STOP". Two runs can both pass this check before either writes.
- **Step 3** then *hand-writes* `$EPIC/.forge/lock.json` with a bespoke field set (`{session_id, command,
  epic_path, ticket, branch, repo_root, pid, started_at}`) — a plain truncating write, not an exclusive create,
  so two runs that both passed step 1 both "acquire".
- **Steps 10/11** *hand-release* by clearing the file, with no ownership check.

So today the orchestrator's "lock" is a convention, not a guarantee: it has a check-then-write TOCTOU and an
unauthenticated release. This epic replaces those three hand-rolled spots with the shipped, atomic, owner-checked
`forge lock` surface, turning the epic lock from *callable* into the **live primary cross-run serialization
guarantee** for the command orchestrator.

## Goal

Wire `commands/forge-run-ticket.md` to call `forge lock acquire | release | status`:

- **acquire** atomically, before active-ticket emission and before branch creation, with an orchestrator-generated
  `run_id` as the ownership key;
- on `LOCK_HELD` / `LOCK_MALFORMED` / any undecidable acquire result, **stop before any mutation** and report;
- **release** owner-checked (`--run-id`) on PASS (after the run-report is written and the ledger append has
  succeeded) and on ESCALATE (after the evidence run-report is written); **hold** the lock across CORRECT cycles;
- never force-break or steal a lock — a foreign/absent/malformed result on release is reported, not forced.

The lock primitive (`src/orchestrator/lock.ts`) and its CLI (`src/orchestrator/lock-cli.ts`) are **imported and
invoked, never edited**. This slice is command-text wiring plus its protocol-lock proof; it touches no Core
behavior and no workflow.

## Sprints

- `sprint-01-orchestrator-lock-wiring` — one ticket: wire the Markdown orchestrator command to `forge lock`,
  proven by a non-tautological protocol-lock test.

## Out of scope (this epic)

- Workflow-backed runner wiring (`workflows/**`) — the workflow runner keeps its current behavior; teaching it to
  call `forge lock` is a separate later slice. The command orchestrator and the workflow runner will briefly
  diverge until that slice lands; that is expected and acceptable.
- Stale-recovery UX — any assisted or forced clearing of a stale or foreign lock. `forge lock status` reports a
  stale verdict; nothing in this slice clears, steals, or force-breaks a lock.
- Evidence-write ownership / `run_id` artifact enforcement across run-report / active-ticket / orchestrator-facts.
- Any change to the shipped lock primitive (`src/orchestrator/lock.ts`), the lock CLI
  (`src/orchestrator/lock-cli.ts`), the ledger modules, the schema, or the CLI router.
- Status write-back; journal write.

## Carried-forward decisions (ratified)

1. The **epic lock is the primary cross-run serialization guarantee**; this slice is what makes that real for the
   command orchestrator.
2. The **CAS ledger append remains defense-in-depth**.
3. The residual CAS re-check-to-rename window is acceptable **only when lock wiring serializes appends** — which is
   precisely what this slice delivers for the command orchestrator path.
4. No stale-recovery UX yet — `status` reports staleness; clearing a stale/foreign lock is a later slice.
5. No workflow wiring in this slice.
6. No evidence ownership / `run_id` artifact enforcement yet (the `run_id` is generated and used as the lock
   ownership key here; broader artifact enforcement is deferred).
