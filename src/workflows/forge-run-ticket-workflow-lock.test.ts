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
      const activeTicketIdx = src.indexOf('writeForgeFile("active-ticket.json"');
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
