import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");

/**
 * Protocol-lock test: forge-run-ticket workflow ↔ forge-lock cross-run serialization.
 *
 * `workflows/forge-run-ticket.workflow.js` is the workflow-backed runner. It must
 * reach cross-run serialization the SAME way the command orchestrator does: by
 * driving the shipped `forge lock acquire | release` surface through the typed
 * `forge-core-runner` bridge — never by a non-atomic file-existence probe.
 *
 * This suite is NON-TAUTOLOGICAL: it asserts both the PRESENCE of the atomic
 * lock-wiring (acquire/release, the ownership key + flags, the fail-closed codes,
 * an `acquired` ownership flag, ordering of acquire before checkpoint capture and
 * active-ticket emission, release on both terminal paths) AND the ABSENCE of the
 * retired TOCTOU probe (`test -f ...lock.json`, `PREFLIGHT_LOCK_EXISTS`). If a
 * future edit re-introduces the probe or drops the wiring, this goes red.
 *
 * We assert on load-bearing tokens (not exact paragraphs) to avoid brittleness on
 * trivial copy edits, mirroring src/commands/forge-run-ticket-protocol.test.ts.
 */

const WORKFLOW_FILE = join(REPO_ROOT, "workflows", "forge-run-ticket.workflow.js");

const text = (): string => readFileSync(WORKFLOW_FILE, "utf8");

describe("forge-run-ticket workflow ↔ forge lock wiring", () => {
  describe("present: atomic lock-wiring through the bridge", () => {
    const REQUIRED_TOKENS: readonly string[] = [
      // The atomic acquire/release CLI calls (the create IS the mutual exclusion).
      "forge lock acquire",
      "forge lock release",
      // The ownership key + acquire flags.
      "--run-id",
      "--session-id",
      "--ticket",
      "--branch",
      "--repo-root",
      // Fail-closed acquire codes (stop before any mutation).
      "LOCK_HELD",
      "LOCK_MALFORMED",
      // The escalate codes the workflow raises on the acquire paths.
      "PREFLIGHT_LOCK_HELD",
      "PREFLIGHT_LOCK_MALFORMED",
      "PREFLIGHT_LOCK_ACQUIRE_FAILED",
      // The ownership flag gating terminal release.
      "acquired",
      // Run identity plumbed from args (launcher-provided, required).
      "runId",
      "sessionId",
    ];

    for (const token of REQUIRED_TOKENS) {
      it(`contains "${token}"`, () => {
        expect(text()).toContain(token);
      });
    }

    it("reads runId and sessionId from args and treats their absence as a hard error", () => {
      const src = text();
      expect(src).toContain("ARGS.runId");
      expect(src).toContain("ARGS.sessionId");
      // Both are required: a guard that throws when either is missing.
      expect(src).toMatch(/args\.runId[^]*?required/i);
      expect(src).toMatch(/args\.sessionId[^]*?required/i);
    });

    it("gates the owner-checked release on the acquired flag", () => {
      const src = text();
      // The acquired flag must be set true on a successful acquire and consulted
      // before a terminal release (so pre-acquire escalations never release).
      expect(src).toMatch(/acquired\s*=\s*true/);
      expect(src).toMatch(/if\s*\(\s*acquired/);
    });
  });

  describe("ordering: acquire before checkpoint and active-ticket emission", () => {
    it("acquire appears before the checkpoint capture (rev-parse HEAD)", () => {
      const src = text();
      const acquireIdx = src.indexOf("forge lock acquire");
      const checkpointIdx = src.indexOf("checkpointBase");
      expect(acquireIdx).toBeGreaterThan(-1);
      expect(checkpointIdx).toBeGreaterThan(-1);
      expect(acquireIdx).toBeLessThan(checkpointIdx);
    });

    it("acquire appears before the active-ticket emission", () => {
      const src = text();
      const acquireIdx = src.indexOf("forge lock acquire");
      // Core now writes the active-ticket byte-exact via `forge active-ticket … --out`
      // (the prose `writeForgeFile("active-ticket.json"` byte-write was retired); the
      // ordering invariant — acquire BEFORE active-ticket emission — is unchanged.
      const activeTicketIdx = src.indexOf('activeTicketWritten');
      expect(acquireIdx).toBeGreaterThan(-1);
      expect(activeTicketIdx).toBeGreaterThan(-1);
      expect(acquireIdx).toBeLessThan(activeTicketIdx);
    });

    it("the owner-checked release runs the forge lock release CLI through the bridge", () => {
      const src = text();
      // The release goes through the typed bridge (runCoreJsonResult), keyed by runId.
      expect(src).toMatch(/forge\b[^]*?lock release[^]*?--run-id/);
    });

    it("release fires on the PASS path (after ledger append + run-report write) and on the escalate path", () => {
      const src = text();
      // The owner-checked release is a single shared helper invoked on both terminal
      // paths; assert the helper exists and is invoked at least twice.
      const helperDefIdx = src.indexOf("async function releaseLockIfOwned");
      expect(helperDefIdx).toBeGreaterThan(-1);
      const invocations = src.match(/releaseLockIfOwned\(\)/g) ?? [];
      // One in the PASS/handoff return, one inside escalate() — the helper def's own
      // name is not an invocation, so two `()` calls is the minimum.
      expect(invocations.length).toBeGreaterThanOrEqual(2);

      // PASS-path release lives AFTER the ledger append.
      const ledgerAppendIdx = src.indexOf("ledger append");
      const passReleaseIdx = src.indexOf("releaseLockIfOwned()");
      expect(ledgerAppendIdx).toBeGreaterThan(-1);
      expect(passReleaseIdx).toBeGreaterThan(ledgerAppendIdx);

      // escalate() invokes the release (owner-aware terminal release on the escalate path).
      const escalateFnIdx = src.indexOf("async function escalate");
      const lastReleaseInvocationIdx = src.lastIndexOf("releaseLockIfOwned()");
      expect(escalateFnIdx).toBeGreaterThan(-1);
      expect(lastReleaseInvocationIdx).toBeGreaterThan(escalateFnIdx);
    });
  });

  describe("absent: the retired TOCTOU probe (non-tautological half)", () => {
    it("does not contain the old test -f lock.json existence probe", () => {
      const src = text();
      expect(src).not.toMatch(/test\s+-f\s+["'`][^"'`]*lock\.json/);
    });

    it("does not contain the retired PREFLIGHT_LOCK_EXISTS escalate code", () => {
      expect(text()).not.toContain("PREFLIGHT_LOCK_EXISTS");
    });
  });

  describe("no force-break / no stale-recovery", () => {
    it("adds no --force / break / steal / stale-clear path", () => {
      const src = text();
      expect(src).not.toContain("--force");
      expect(src).not.toMatch(/force[-_ ]?break/i);
      expect(src).not.toMatch(/\bsteal\b/i);
    });
  });
});

/**
 * Protocol-lock test: the workflow obtains every read-only repo fact from
 * `forge repo snapshot` through the typed core-runner bridge, and NO LONGER
 * shells raw `git -C` (which the live PreToolUse Bash hook intercepts).
 *
 * NON-TAUTOLOGICAL: asserts both the PRESENCE of `repo snapshot` wiring AND the
 * ABSENCE of every raw-git surface (`git -C`, and the retired
 * `runGitText`/`runGitInt` helpers). If a future edit re-introduces a raw git
 * call or drops the snapshot wiring, this goes red.
 */
describe("forge-run-ticket workflow ↔ forge repo snapshot wiring", () => {
  describe("present: read-only repo facts via the snapshot bridge", () => {
    it("calls forge repo snapshot", () => {
      expect(text()).toMatch(/repo snapshot/);
    });

    it("derives the preflight clean-tree precondition from the snapshot (a `clean` field)", () => {
      const src = text();
      // The snapshot's `clean` boolean drives the dirty-tree escalate.
      expect(src).toMatch(/\.clean/);
      expect(src).toContain("PREFLIGHT_DIRTY_TREE");
    });

    it("derives checkpoint base/head and branch from the snapshot (head/branch fields)", () => {
      const src = text();
      expect(src).toMatch(/\.head\b/);
      expect(src).toMatch(/\.branch\b/);
    });

    it("derives final changed-files and ahead-of-base from the snapshot", () => {
      const src = text();
      expect(src).toMatch(/changed_files/);
      expect(src).toMatch(/ahead_of_base/);
    });
  });

  describe("absent: raw git surfaces are gone (non-tautological half)", () => {
    it("contains no raw `git -C` call", () => {
      expect(text()).not.toMatch(/git -C/);
    });

    it("does not define the retired runGitText helper", () => {
      expect(text()).not.toContain("runGitText");
    });

    it("does not define the retired runGitInt helper", () => {
      expect(text()).not.toContain("runGitInt");
    });
  });
});

/**
 * Protocol-lock test: the two blockers the workflow live-proof rerun found are
 * closed so the runner reaches full happy-path PASS under the live hook.
 *
 *  1. Core writes the active-ticket byte-exact via `forge active-ticket … --out`
 *     (a Core-owned fs write), instead of handing JSON bytes to the core-runner
 *     agent to "write exact bytes" (which corrupted Windows-path backslashes in
 *     `repo_root` → invalid JSON → guard `ACTIVE_TICKET_INVALID`).
 *  2. The scope verifier scope-checks from Core-owned changed-file facts (the
 *     `forge repo snapshot` `changed_files`) injected into its dispatch prompt,
 *     instead of shelling git against a repo that is not its Bash cwd.
 *
 * NON-TAUTOLOGICAL: asserts the PRESENCE of `active-ticket … --out` and the
 * Core-diff-into-scope-verifier wiring, and the ABSENCE of the prose byte-write
 * for active-ticket (no `writeForgeFile("active-ticket.json"` call).
 */
describe("forge-run-ticket workflow ↔ Core-owned active-ticket write + Core-fed scope diff", () => {
  describe("present: Core writes the active-ticket byte-exact via --out", () => {
    it("calls forge active-ticket with --out targeting the .forge active-ticket.json path", () => {
      const src = text();
      expect(src).toMatch(/active-ticket\b[^]*?--out/);
      // The --out target is the .forge active-ticket.json the guard reads.
      expect(src).toMatch(/--out[^]*?active-ticket\.json/);
    });
  });

  describe("absent: the prose byte-write for active-ticket is gone (non-tautological half)", () => {
    it('does not route active-ticket.json through writeForgeFile (the agent byte-write)', () => {
      expect(text()).not.toContain('writeForgeFile("active-ticket.json"');
    });
  });

  describe("present: the scope verifier is fed the Core repo-snapshot changed files", () => {
    it("injects the Core changed_files into the scope-verifier dispatch prompt", () => {
      const src = text();
      // The scope prompt the verifier receives must carry the authoritative Core
      // diff; assert the snapshot changed_files are appended to the scope prompt
      // before the scope-verifier agent dispatch (mirroring engineer corrections).
      const scopePromptIdx = src.indexOf("scopePrompt");
      const scopeDispatchIdx = src.indexOf('agentType: "forge-scope-verifier"');
      expect(scopePromptIdx).toBeGreaterThan(-1);
      expect(scopeDispatchIdx).toBeGreaterThan(-1);
      // A scope prompt augmented with the Core diff exists and is what is dispatched.
      expect(src).toMatch(/scopePromptWithDiff|scopePrompt\b[^]*?changed_files/);
      // The label tells the verifier this is the authoritative Core diff for repoRoot
      // to use instead of running git.
      expect(src).toMatch(/authoritative[^]*?repoRoot|Core diff[^]*?repoRoot/i);
    });

    it("the scope-verifier dispatch uses the diff-augmented prompt, not the bare scopePrompt", () => {
      const src = text();
      // The dispatch call for the scope verifier passes the augmented prompt variable.
      expect(src).toMatch(/agent\(\s*scopePromptWithDiff/);
    });
  });
});
