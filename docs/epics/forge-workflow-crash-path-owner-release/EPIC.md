# Epic — Crash-path owner-checked release on unhandled workflow failure (F2)

## Why

The workflow-backed runner acquires a cross-run epic lock and is expected to release it owner-checked at every
terminal outcome. Two terminal paths do this correctly today — `escalate()` and the PASS/handoff return, both via
`releaseLockIfOwned()` (`workflows/forge-run-ticket.workflow.js:866-875`). But there is **no try/catch around the
post-acquire lifecycle**: any unhandled throw between lock acquire (`:447-448`) and a terminal return propagates
out of the workflow and **bypasses the owner-checked release**, leaving `lock.json` orphaned on the epic.

This is not hypothetical. The launch-cwd operability run (`docs/workflow-launch-operability-finding.md`, F2) hit
exactly this: `writeForgeFile` threw on a built-in-classifier denial (`:226-228`), the throw escaped, and the lock
was orphaned until a separate human-approved owner-checked release cleared it. The F1 spike
(`docs/workflow-role-output-persistence-spike-finding.md`) then established that the triggering denial is
occasional / probabilistic / context-sensitive — so the workflow **must survive it cleanly** rather than crash.
The persistence re-architecture (F1) is deferred and open; making the workflow resilient to a substrate failure it
cannot make deterministic is the higher-value first fix.

## What

Wrap the workflow lifecycle so that **any unhandled post-acquire error** performs an owner-checked release (a
no-op when nothing was acquired) and emits a **typed terminal outcome** — never an orphaned lock or a bare crash.
The release machinery already exists and is sufficient; this is a workflow **control-flow** change, not a Core
change.

The **critical distinction** the contract preserves: **lock release is critical; run-report/evidence emission is
best-effort.** The failure may occur *during* evidence/report persistence, so an evidence-writing failure must
never prevent the owner-checked release.

## Scope discipline

A focused, bounded resilience fix to one file plus its tests. It does NOT change the lock primitive, the release
API, the role-output persistence surfaces (that is F1, deferred), the launcher (that is F3, a separate follow-up),
the charters, the hook, or the command orchestrator. F1 remains open and architectural; F3 (launcher cleanup
EPERM → typed UX) is explicitly a separate small follow-up epic, not part of this contract.

## Tickets

- **T01** — Crash-path owner-checked release on unhandled workflow failure.

## Claude Code Substrate Review

- **Workflows (execution):** the workflow is the only ForgeGate component that holds the cross-run lock across a
  long, multi-agent lifecycle, so it is the only place an unhandled throw can orphan the lock. The command
  orchestrator (`commands/forge-run-ticket.md`) runs its lifecycle in the main session and is out of scope.
- **Forge Core (governance):** unchanged. `forge lock release --run-id` is already owner-checked and idempotent
  for the same owner (#53); the workflow's `releaseLockIfOwned()` already gates on `acquired` and keys on `runId`.
  The fix consumes these unchanged — `src/orchestrator/lock.ts` is forbidden.
- **The substrate failure being handled:** the built-in Claude Code auto-mode classifier can (probabilistically)
  deny a `.forge/**` persistence write by the core-runner; that denial surfaces as an unhandled throw today. F2
  does not prevent the denial (that is F1's domain) — it converts the resulting failure into a clean terminal
  stop. This is NOT "retry until green"; it is graceful terminal handling of a non-deterministic substrate.
- **Tests:** the failure path is unit/protocol-testable without a live Workflow-tool run — source-level protocol
  assertions on the lifecycle wrapping plus an extract-and-execute test of the pure terminal-outcome builder
  (mirroring the launch-cwd `evaluateLaunchCwd` pattern). No live run is a gate for this ticket.
