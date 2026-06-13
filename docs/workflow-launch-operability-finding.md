# Finding — workflow launch operability confirmation (2026-06-12)

> **Classification: `PARTIAL_OPERABILITY_CONFIRMED_WITH_BLOCKERS`.** The first end-to-end exercise of the
> Forge-owned OS-temp launcher path (shipped in PR #57) proved scratch placement, the launcher's full
> prepare → post-scan → cleanup lifecycle, and the strict launch-cwd gate's live safe path — and honestly stopped
> short of full workflow operability on three real findings (F1/F2/F3 below). This records the finding; it is not
> a contract. The machine evidence is preserved (gitignored) at
> `.forge/launch-evidence/bef9af6c-d14a-4701-9cee-e286ace00730.json`.

## The run

| Item | Value |
|---|---|
| Baseline | `main @ 08856ae` (PR #57 merged; install refresh + `verify-install` OK; 716/716 tests) |
| Proof `run_id` | `bef9af6c-d14a-4701-9cee-e286ace00730` |
| `session_id` | `3c5a82c1-018f-403d-a371-f6657e904641` |
| Workflow run | `wf_0c098781-275` (23 agents, ~12.7 min, fresh OS-temp-launched Claude session) |
| Scratch launch cwd | `C:/Users/dsj74/AppData/Local/Temp/forge-launch-bef9af6c-d14a-4701-9cee-e286ace00730` |
| Target proof repo | `D:/Projects/forge-workflow-live-proof` (disposable clone, clean @ `08856ae` at launch) |
| Proof epic | `D:/Projects/forge-workflow-live-proof/sandbox-epic` (sterile fixture) |
| Launcher evidence | `D:/Projects/forge/.forge/launch-evidence/bef9af6c-d14a-4701-9cee-e286ace00730.json` (gitignored) |

Procedure: `scripts/launch-workflow.mjs prepare` ran in the orchestrator session and emitted the scratch cwd, the
run identity, and the complete workflow args (including the strict `scratchCwd` expectation); the human launched a
fresh `claude` session FROM the scratch cwd and invoked the Workflow tool on
`workflows/forge-run-ticket.workflow.js` with exactly those args; post-scan and cleanup ran back in the
orchestrator session after the run.

## Proven

- **Scratch placement proven (again, now through the launcher's own evidence chain):** pre-scan zero `TEMP*` in
  all three locations; **post-scan `clean: true`** across the session repo, the target repo, and the launch cwd —
  after 23 agents executed from the OS-temp launch. The post-scan scanner is calibrated to the full historical
  artifact corpus (the PR #57 focused-review correction), so "clean" now means clean against every observed shape.
- **Launcher `prepare` proven:** per-run Forge-owned scratch dir created under the realpath'd OS temp root,
  identity minted, repo facts captured hook-free, evidence written gitignored, exact launch instruction + args
  emitted.
- **Launcher `post-scan` proven:** re-scanned all three locations and recorded the result into the evidence.
- **Launcher `cleanup` proven** (after the scratch-launched session closed): ownership-verified removal of only
  the Forge-owned scratch dir; the archived evidence survived and records the cleanup.
- **Strict launch-cwd gate safe path LIVE-PROVEN** — the deliberately-unproven piece from PR #57's governed run.
  The bridge probe observed exactly the declared scratch cwd
  (`{"cwd": "C:\\Users\\dsj74\\AppData\\Local\\Temp\\forge-launch-bef9af6c-…", "tmpdir": "C:\\Users\\dsj74\\AppData\\Local\\Temp"}`),
  the gate passed, and the run proceeded into preflight and beyond under the real harness.
- **Guard depth reached:** `forge guard paths` against the Core-written active-ticket returned
  `{"ok": true, "findings": []}`, exit 0.
- **Agent-schema bridge depth reached (not INCONCLUSIVE):** engineer output persisted + `parse-agent` ok;
  semantic-verifier APPROVE persisted + `parse-agent` ok; the scope-verifier agent ran and returned a
  schema-validated structured APPROVE (clean fence, no violations). The epic lock was acquired atomically with
  this run's id before any mutation.
- **Owner-checked lock release succeeded after approval:** `forge lock release --run-id bef9af6c-…` → `{ok: true}`,
  `lock.json` gone — the designed release mechanism, exercised with the original run owner id (see F2).

## Not proven / not closed

- **Full workflow operability is NOT closed.**
- The run **did not reach the PM stage** and **did not reach the terminal commit-gate handoff**.
- The workflow **failed while persisting the scope-verifier output**: the `writeForgeFile` bridge call for
  `sandbox-epic/.forge/scope-verifier-output.json` was denied (F1) and the resulting unhandled throw terminated
  the run (F2).

## Findings

### F1 — role-output persistence substrate seam (architectural; discovery first)

Claude Code's **built-in auto-mode classifier** — present even in this hook-less scratch-launched session —
denied the `forge-core-runner` bridge agent's write of the scope-verifier's APPROVE verdict into `.forge/`,
reasoning that an agent was "writing a fabricated scope-verifier APPROVE verdict the agent never actually
performed" — i.e. **verification stamping: the persisting agent was not the verifying agent.** The denial
explicitly noted the file was not written and that retrying the same bytes through another tool would bypass the
denial's intent.

Critically, the **same persistence pattern succeeded minutes earlier in the same run** for the engineer output
and the semantic-verifier output (and in every prior live proof). The seam is therefore **content-sensitive and
non-deterministic** — it cannot be dismissed as a simple permissions misconfiguration, and "retry and hope" is
not operability. This is the same architectural family as the Windows byte-corruption that PR #48 closed for
`active-ticket` (Core `--out`): **prose-handed persistence through a subagent is fragile**.

Required next step: **discovery first.** Potential directions include role-owned writes (the verifier persists
its own verdict, so writer = verifier), Core-owned ingest of role output, or another persistence path that does
not require a different agent to re-stamp verifier output. This finding deliberately does **not** prescribe the
final design.

### F2 — crash-path lock orphan

The unhandled persist failure threw out of the workflow **bypassing the owner-checked terminal release**, leaving
`lock.json` on the clone's epic with this run's `run_id`. Also recorded:

- The **owner-checked release later succeeded with the original `run_id`** (human-approved; `{ok: true}`;
  `lock.json` removed) — confirming the cleanup **mechanism** exists and works exactly as designed; what is
  missing is the workflow invoking it on the crash path.
- The workflow's crash path needs a **bounded fix**: an unhandled error after acquire should still perform the
  owner-aware release (and surface a typed escalation) rather than orphaning the lock.
- **Stale-recovery UX is now concretely justified by a real orphaned lock** from a real crash — previously a
  deferred backlog item, now demonstrated need.

### F3 — launcher cleanup EPERM UX

The first `cleanup` attempt failed with a raw `EPERM` stack because the scratch-launched Claude session still had
the scratch dir as its process cwd (Windows will not remove a live process's working directory). After that
session was closed, cleanup succeeded under the full ownership guard. Operationally understandable — but the
launcher should catch this and emit a **typed `CLEANUP_BLOCKED` result with a close-the-scratch-session hint**
instead of a raw stack, matching the typed-failure contract of its other paths.

## Conclusion

The launcher path is validated for scratch placement and strict launch-cwd gate safety, but ForgeGate workflow
operability remains blocked on role-output persistence (F1) and crash-path lock handling (F2). The next sequence
is: **finding doc → F1 discovery → contract for the F1/F2/F3 fixes** — kept under this single evidence packet so
the fixes inherit the exact proof context.
