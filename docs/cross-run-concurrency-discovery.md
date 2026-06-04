# Cross-Run Concurrency — Discovery / Contract Proposal

> Discovery/contract only. Author: senior engineer, 2026-06-03. Status: **for PM review — no implementation, no
> product code change, no settings/hook/orchestrator edit.** Classification: **trust-seam gap (provenance +
> evidence integrity).** Scope: identify and contract the cross-run concurrency gap; recommend a locking model and
> an implementation sequence. Nothing here changes behavior; it is the proposal Dan reviews before any ticket.

---

## 1. Discovery summary

ForgeGate's single-run provenance seams (gate, decision-id) are closed, but **nothing serializes two runs that
target the same repo.** All shared run state is per-epic on-disk JSON under `$EPIC/.forge/` written with naive
truncating `fs.writeFileSync` (last-writer-wins), the PM decision-id is allocated by an un-atomic read-modify-write
on the ledger, and the only mutual-exclusion that exists — `lock.json` — lives **only in the Markdown orchestrator
as a check-then-write convention**, not in Core. Consequences: two concurrent runs can select the same ticket,
derive the same `decision_id`, clobber each other's evidence files, and corrupt the monotonic ledger — defeating
exactly the determinism/provenance guarantees the product sells. Core owns none of this today; the substrate
(harness) offers no cross-run lease primitive, so **Core must own a real lock + an atomic ledger append.** This is
the next real trust seam after the four-class hook, CI, and L3 verification.

**Severity:** the decision-id and evidence-integrity races are the serious ones — they can silently produce
duplicate `D-001`s or a run-report attributed to the wrong run, both of which are provenance corruption, not mere
inconvenience. The shared-git-worktree race is real but already partly mitigated by the per-ticket branch + the
orchestrators' own discipline.

---

## 2. Current state — per-run vs shared (Q1) and the collision surface (Q2)

### Per-run (not shared)
- The orchestrator's in-turn/in-session memory and the `session_id` it stamps.
- The per-ticket feature branch it proposes/creates (`forge/<epic>/<ticket>-<slug>`) — distinct branch *name* per
  ticket, but it lives in the one shared worktree (see git note below).

### Shared (per-epic, single fixed path → collidable) — **everything that matters**
All under `$EPIC/.forge/`, each a single fixed filename, all written via naive `writeFileSync`:

| File | Writer | Role | Collision effect |
|---|---|---|---|
| `decisions-ledger.json` | Core (`forge ledger append`, `ledger-cli.ts:36`) | monotonic PM decision-id source | duplicate / lost decision-id |
| `active-ticket.json` | orchestrator (from `forge active-ticket` JSON) | the guard's fence source | guard checks the wrong run's fence |
| `orchestrator-facts.json` | orchestrator | PM-input confirmed facts | run A reads run B's facts |
| `run-report.json` | Core (`forge run-report write`, `cli.ts:77`) | the gate evidence artifact | run A's report overwritten by run B |
| `validation-report.json` | Core (`cli.ts:14`) | validation evidence | overwrite (low harm; regenerable) |
| `lock.json` | **orchestrator only** (Markdown) | mutual exclusion convention | check-then-write TOCTOU; not Core-enforced |
| `<role>-output` (engineer/…) | orchestrator (verbatim capture) | agent evidence | one run's capture clobbers another's |

### The git worktree (shared, not under `.forge/`)
Concurrent runs — even on **different epics** — share one working tree, index, and branch namespace. `git add`,
branch creation, and checkpoint reads all operate on the same worktree. Two runs staging/branching simultaneously
race at the git layer independently of `.forge/`.

### What Core enforces today: **nothing cross-run.**
`grep` confirms no `lock.json` read/write in `src/**`, no `O_EXCL`/`wx` exclusive create, no atomic temp+rename.
The `lock.json` protocol is entirely in `commands/forge-run-ticket.md` (acquire/check/release as prose steps). The
**workflow-backed runner** (`workflows/forge-run-ticket.workflow.js`) is a *second* orchestrator — whether it
replicates the lock convention at all must be confirmed; if not, it has **no** mutual exclusion.

---

## 3. Concrete race scenarios

**R1 — Same-epic double-select (Q3).** Two runs call `forge active-ticket <epic>`; selection is deterministic
(next ready ticket), so both get **T01**. No Core claim/lease prevents it. Both proceed to engineer T01 in the same
worktree. The orchestrator `lock.json` *would* stop the second — but it is check-then-write (itself racy) and only
the Markdown orchestrator honors it.

**R2 — Decision-id collision (Q4).** Run A and Run B both reach the PM step. Both read
`decisions-ledger.json` = `[D-001]`. Both compute `nextDecisionId = D-002`. Both validate `D-002` against their
*own snapshot* (the `LEDGER_SEQUENCE_INVALID` check passes for both, because it only sees the at-rest snapshot).
Both append and `writeFileSync`. Result: **lost update** (`[D-001, D-002]` with one run's decision silently
dropped) or **duplicate** (`[D-001, D-002, D-002]` if interleaved as read-A, read-B, write-A, write-B against a
re-read). Either way the monotonic-decision-id guarantee — a *closed* single-run seam — breaks across runs.

**R3 — Ledger append interleave (Q5).** `appendDecision` is `read → compute expected → validate → writeFile` with
the IO seam documented *"caller is responsible for atomicity."* No file lock, no compare-and-swap, no atomic
rename. Any interleaving of two appenders corrupts sequence integrity. The on-disk `superRefine` (unique +
strictly-increasing) catches a *malformed at-rest* ledger on the next read, but does not prevent the racing write.

**R4 — Evidence overwrite (Q6).** `active-ticket.json`, `orchestrator-facts.json`, and `run-report.json` are fixed
per-epic filenames written by truncating `writeFileSync`. Run B's `forge run-report write` overwrites Run A's
report; Run A's guard reads Run B's `active-ticket.json` fence; Run A's PM input reads Run B's
`orchestrator-facts.json`. **Evidence provenance corruption** — the artifact no longer faithfully records the run
it claims to.

**R5 — Shared-worktree git race.** Two runs (any epics) `git add`/branch/checkpoint against one index/worktree:
interleaved staging stages the other run's files; branch state and `HEAD` are shared. Independent of `.forge/`.

---

## 4. Recommended locking model (Q7, Q8, Q9)

### Q7 — Granularity: epic-level primary, plus a worktree/repo serialization for git
- **Epic-level exclusive lock** is the right primary unit: the contract and all `.forge/` state are per-epic, and a
  run operates on one epic's next ticket. (Repo-level alone is too coarse — it needlessly blocks unrelated epics;
  ticket-level is too granular — a run already owns the epic.)
- **The shared git worktree is a separate axis.** Two epics can run concurrently without `.forge/` collision but
  still race on the worktree. Two viable answers: (a) **require per-run worktree isolation** (each run in its own
  `git worktree`), or (b) a **repo-level git-serialization lock** for the mutating git window. Recommend (a) as the
  direction — but see the substrate tension in §9 (worktree isolation fragments the shared ledger).

### Q8 — Acquisition / failure behavior
- **Atomic exclusive create** of `$EPIC/.forge/lock.json` via `fs.open(file, "wx")` (O_EXCL) — the create *is* the
  mutual exclusion (no check-then-write TOCTOU). Move this into **Core** (`src/orchestrator/lock.ts`) so **both**
  orchestrators and any direct CLI honor it, not just the Markdown prose.
- **Typed lock schema** (`forge-lock/v1`): `{ schema, run_id, session_id, pid, host, epic_path, ticket, branch,
  repo_root, acquired_ts, heartbeat_ts }`, Zod-validated like the run-report.
- **Fail-closed on contention:** if the file exists, refuse to start → `LOCK_HELD`, print the holder + a staleness
  verdict + recovery guidance. **Never overwrite silently.**
- **Decision-ledger CAS regardless of the lock** (defense in depth): make `appendDecision` atomic — re-read +
  recompute expected id and write via temp-file + atomic `rename` (or hold the lock), so a caller that skips the
  lock still cannot duplicate an id. This closes R2/R3 even if R1's lock is bypassed.
- **Evidence writes refuse under a foreign lock:** `run-report write` / `active-ticket` / facts capture verify the
  held lock's `run_id` before writing, or write to a `run_id`-namespaced path. (This forces the deferred `run_id`
  question — see §6.)

### Q9 — Stale-lock recovery
- A lock is **stale** when: `pid` is not alive *on the same host*, OR `heartbeat_ts` exceeds a freshness threshold,
  OR `acquired_ts` exceeds a max-run TTL. Cross-host: `pid` liveness is unverifiable → rely on heartbeat/TTL +
  explicit human confirm.
- Surface: `forge lock --status <epic>` (show holder + staleness verdict) and `forge lock --release <epic>`
  (human-gated, refuses to clear a *live* lock). Optionally fold into a future `forge doctor`.
- **Never auto-steal silently.** A stale lock is *reported* with a recovery command the human runs — consistent
  with the product's human-gated posture. Auto-clean only a provably-dead same-host pid, and even then log it.

---

## 5. Proposed allowed_paths / forbidden_paths (for the eventual implementation ticket — NOT this discovery)

**allowed_paths (suggested, to be split across slices — see §8):**
- `src/orchestrator/lock.ts` (new — Core lock primitive) + `src/orchestrator/lock.test.ts`
- `src/orchestrator/decisions-ledger.ts` (CAS/atomic append hardening) + its test
- `src/cli/run.ts` (wire `forge lock` subcommand; guard evidence writes)
- `src/run-report/cli.ts` (refuse-write-under-foreign-lock)
- `README.md` (document the locking model + recovery)
- `docs/epics/<concurrency-epic>/**` (the contract itself)

**forbidden_paths (suggested):**
- `agents/**`, `.claude/**`, `.github/**`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `vitest.config.ts`,
  `sandbox-epic/**`, `pilot-local/**`, `**/.forge/**`
- `commands/forge-run-ticket.md` and `workflows/forge-run-ticket.workflow.js` — orchestrator wiring is a **separate,
  later slice** (keep the Core primitive ticket pure); list them forbidden in the Core-primitive ticket.

---

## 6. Risk classification

- **Risk: high.** Touches decision-id provenance and run-report evidence integrity — the product's trust core. A
  bug here corrupts provenance, the exact thing ForgeGate guarantees.
- **change_class:** propose **`feature`**, NOT `infra`. ⚠️ The escalation matcher auto-escalates
  `change_class ∈ {migration, security, infra, dependency}`; "infra" would trip `AUTO_ESCALATION_REQUIRED`. Locking
  is plausibly "infra" semantically, but to keep the gate at `pr` we should class it `feature` and keep contract
  prose clean of the keyword set (`delete/remove/rm -rf/...` — use "release"/"clear"/"reclaim", not "delete", for
  the lock). Confirm `gate: pr, no escalation` via `forge run --dry-run` before authoring is final.
- **blast_radius:** `app` (repo-wide tooling tier; `repo` is not a schema enum).
- **gate:** `pr` (a Core safety mechanism, human-reviewed; not `merge`).
- **Determinism guard:** the lock/CAS must be deterministic and fail-closed; no hidden auto-steal. Any auto-clean is
  a logged, narrowly-scoped exception.

---

## 7. Acceptance criteria (Q10 — tests/proofs)

1. **Atomic lock acquire** via `wx`/O_EXCL: first acquire succeeds; a second acquire while held → `LOCK_HELD` with
   holder info; release removes the lock; re-acquire after release succeeds.
2. **No check-then-write TOCTOU:** the acquire is a single exclusive-create syscall, proven by a test that a second
   create against an existing lock throws `EEXIST` and is surfaced as `LOCK_HELD` (no overwrite).
3. **Stale detection:** dead-pid (same host), expired-heartbeat, and TTL-exceeded all classified stale; a *live*
   lock is never auto-cleared; `--release` refuses a live lock.
4. **Ledger append is atomic / CAS:** a deterministic interleave harness (injected IO ordering: read-A, read-B,
   write-A, write-B) asserts the second append is **rejected or re-sequenced** — never a lost update or duplicate
   id. The post-state ledger always passes `DecisionsLedgerSchema` (unique + strictly increasing).
5. **Evidence-write guard:** `run-report write` / `active-ticket` / facts capture under a *foreign* `run_id` lock
   are refused (or namespaced); under the held `run_id` they succeed.
6. **Selection-under-lock:** a second `active-ticket`/run start on a locked epic is refused with `LOCK_HELD`,
   surfacing recovery — proving R1 is closed.
7. **No silent overwrite anywhere:** all `.forge/` writers either hold the lock or fail closed; no naive
   truncating write of a shared file under contention.
8. **Existing suites stay green** (`pnpm test`, `pnpm typecheck`); no change to single-run behavior when no second
   run contends (operational positive control — the *good* single-run path is unaffected, proven loudly).
9. **Disposable-clone concurrency proof:** two simulated runs race the same epic in a clone; the second is refused;
   ledger + evidence remain valid and un-corrupted; real worktree untouched.

---

## 8. Verification plan

- **Unit (deterministic):** lock acquire/contend/release/stale; CAS-append interleave harness; evidence-write
  refusal. All behind injected IO seams (mirroring `DecisionsLedgerIo`/`InstallReader`) so no real parallel process
  is needed to prove the invariants — interleaving is simulated deterministically.
- **Property/regression:** randomized interleavings of N appenders never violate `DecisionsLedgerSchema`.
- **Integration:** a small harness spawns two real `forge` processes against a clone epic to confirm the exclusive
  create actually serializes at the OS layer (the one place a real race must be observed, not simulated).
- **Governed proof:** run the eventual ticket through ForgeGate itself in a disposable clone (per the established
  proof discipline) — semantic/scope/PM — with the concurrency proof as evidence.
- **No destructive ops** in any proof; lock contention is observed via exclusive-create `EEXIST`, never by forcing
  a corrupt state on the real repo.

---

## 9. Claude Code Substrate Review (standing rule)

- **Workflows (execution):** the realistic race source is **two concurrent Workflow runs**, or a Workflow runner +
  the Markdown orchestrator, against one repo. The Workflow tool's `isolation: 'worktree'` addresses the **shared
  git-worktree** race (R5) — but it **fragments the shared `.forge/` state**: a separate worktree has its own
  `docs/epics/<epic>/.forge/decisions-ledger.json`, so two worktree-isolated runs would each start from an empty/
  independent ledger and both mint `D-001` → the cross-run decision-id guarantee *breaks worse*, not better. **Key
  tension:** the decision-ledger must be shared (single source of truth) precisely so it cannot be per-worktree.
  Resolution likely: the ledger (and lock) live at a **stable, non-worktree-fragmented location** (e.g. keyed to the
  canonical repo/epic identity, or a shared lock dir), not inside the per-worktree tree. This is the deepest design
  question and must be settled in the contract.
- **Structured output / agent-types / hooks:** none address cross-run state. The permission hook is per-command, not
  cross-run; `permissions.deny` cannot express a lease. Agent-type isolation is orthogonal. So **substrate-prevent
  is unavailable here** — there is no harness primitive for a repo-wide lease.
- **Forge Core (governance):** therefore the lock + atomic ledger are a **Core-owned, Core-enforced** concern
  (governance/provenance), not an orchestrator convention. This is Core-attest *and* Core-enforce: the exclusive
  create + CAS are real mechanisms Core executes, the strongest form available. *Workflows execute, ForgeGate
  governs, humans approve* — concurrency control is squarely ForgeGate's to own.
- **Agent SDK:** future; not relevant.

---

## 10. Recommendation — implementation sequencing

Ship as independently-provable slices, highest-value / lowest-coupling first. **Do not implement any of this until
the contract is approved.**

1. **Core lock primitive** (`src/orchestrator/lock.ts`): typed `forge-lock/v1`, atomic `wx` acquire, fail-closed
   contention, explicit release, staleness rules. Standalone, unit-tested. **(Start here.)**
2. **Atomic / CAS ledger append** (`decisions-ledger.ts`): close R2/R3 independent of the lock (temp+rename +
   expected-id recheck, or lock-guarded). Highest provenance value; small surface.
3. **Resolve the shared-vs-worktree ledger/lock location** (§9 tension) — a design decision the contract must make
   *before* wiring orchestrators, because it determines where the lock and ledger physically live.
4. **Guard evidence writes** under the held lock (`run-report`/`active-ticket`/facts) — forces the `run_id` question
   (currently a deferred v1 boundary; concurrency is what makes it real).
5. **Wire both orchestrators** (Markdown + workflow) to the Core lock — replace the convention-level `lock.json`.
   Separate slice; keep the Core-primitive tickets pure.
6. **Stale-recovery surface** (`forge lock --status/--release`, or a future `forge doctor`).

**My recommendation to Dan:** approve slices **1 + 2** as the first concurrency contract (Core lock primitive +
atomic ledger append), with §9's ledger-location decision made up front, and **defer 4–6** to follow-on tickets.
That closes the two genuinely-dangerous races (decision-id corruption, lock-race start) with the smallest, most
provable Core change, and leaves orchestrator wiring + `run_id` evidence-namespacing as deliberate later scope.

---

## Open questions for the PM
1. **Ledger/lock physical location** under worktree isolation (§9) — shared canonical location vs per-worktree? This
   gates everything else.
2. **`run_id` introduction** — concurrency forces it for evidence-namespacing; accept it now (slice 4) or keep
   evidence lock-guarded without a `run_id`?
3. **Worktree isolation as policy** — do we *require* per-run worktrees (and solve §9), or serialize git under a
   repo lock and keep one worktree?
4. **Scope of the first ticket** — slices 1+2 only (my recommendation), or 1+2+3 together since 3 is a design gate?
