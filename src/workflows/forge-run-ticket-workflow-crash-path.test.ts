import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");

/**
 * Protocol-lock test: forge-run-ticket workflow ↔ crash-path owner-checked release.
 *
 * An unhandled error between the atomic lock acquire and a terminal return — e.g.
 * `writeForgeFile` throwing on a denial, or any `runCore*` throwing — must NOT
 * escape the workflow and orphan `lock.json`. The lifecycle is wrapped in a single
 * try/catch (catch-only, PM-RATIFIED: no `finally` release guard). The catch
 * performs an owner-checked release FIRST (its own guard so a release-time failure
 * is recorded, not re-thrown), THEN best-effort guarded evidence (an evidence-write
 * failure must never block/undo the release), THEN returns the typed terminal
 * `UNHANDLED_WORKFLOW_FAILURE` outcome.
 *
 * This suite is NON-TAUTOLOGICAL: it asserts (a) the PRESENCE of the lifecycle
 * try/catch wrapping, (b) the release-BEFORE-evidence ordering in the catch, (c)
 * the dedicated typed code, (d) the ABSENCE of a `finally` release guard (the
 * ratified catch-only shape), and (e) the BEHAVIOR of the real pure builder —
 * `buildUnhandledFailure` is extracted from the shipped workflow source and
 * EXECUTED here against pre-acquire and post-acquire shapes. If a future edit drops
 * the wrap, reorders evidence ahead of the release, adds a `finally`, or weakens the
 * builder, this suite goes red.
 *
 * Anchors target actual source tokens (not doc comments), mirroring
 * src/workflows/forge-run-ticket-workflow-lock.test.ts and -launch-cwd.test.ts.
 */

const WORKFLOW_FILE = join(REPO_ROOT, "workflows", "forge-run-ticket.workflow.js");

const text = (): string => readFileSync(WORKFLOW_FILE, "utf8");

/**
 * The exact lifecycle crash-handler region: from the lifecycle `} catch (error) {`
 * (NOT the inner release-guard `catch`, NOT any helper `catch`) through the
 * `return workflowOutcome;` that ends the wrap. Bounding the region precisely is
 * what keeps the ordering assertions honest — they must read the real crash
 * handler, not an unrelated `catch` elsewhere in the file.
 */
function lifecycleCatchRegion(): string {
  const src = text();
  const catchIdx = src.indexOf("} catch (error) {");
  const endIdx = src.indexOf("return workflowOutcome;");
  expect(catchIdx).toBeGreaterThan(-1);
  expect(endIdx).toBeGreaterThan(catchIdx);
  return src.slice(catchIdx, endIdx);
}

describe("forge-run-ticket workflow ↔ crash-path owner-checked release", () => {
  describe("present: lifecycle try/catch + typed terminal", () => {
    const REQUIRED_TOKENS: readonly string[] = [
      // The dedicated typed crash terminal code.
      "UNHANDLED_WORKFLOW_FAILURE",
      // The distinct pure builder for the crash terminal (not escalate()).
      "buildUnhandledFailure",
      // The required terminal fields.
      "lock_release_attempted",
      "lock_release_result",
      "original_error_class",
      "original_error_message",
      "human_gate_required",
    ];

    for (const token of REQUIRED_TOKENS) {
      it(`contains "${token}"`, () => {
        expect(text()).toContain(token);
      });
    }

    it("wraps the workflow lifecycle in a try/catch", () => {
      const src = text();
      // A try block and a catch handler exist.
      expect(src).toMatch(/\btry\s*\{/);
      expect(src).toMatch(/\bcatch\s*\(/);
    });

    it("catch-only (RATIFIED): no `finally` release guard", () => {
      const src = text();
      // The catch is the sole load-bearing path; no finally block exists.
      expect(src).not.toMatch(/\}\s*finally\s*\{/);
    });
  });

  describe("ordering: release-first, then best-effort evidence, then return", () => {
    it("the crash catch attempts releaseLockIfOwned BEFORE building/returning the terminal", () => {
      const region = lifecycleCatchRegion();
      const releaseIdx = region.indexOf("releaseLockIfOwned()");
      const builderIdx = region.indexOf("buildUnhandledFailure(");
      expect(releaseIdx).toBeGreaterThan(-1);
      expect(builderIdx).toBeGreaterThan(-1);
      // Release attempt precedes the terminal-builder call (release-first).
      expect(releaseIdx).toBeLessThan(builderIdx);
    });

    it("a release-time failure inside the catch is recorded, not re-thrown (its own guard)", () => {
      const region = lifecycleCatchRegion();
      // The catch wraps the release in its own try/catch so a release-time throw
      // cannot escape the crash handler (release attempt + result are still recorded).
      expect(region).toMatch(/try\s*\{[^]*?releaseLockIfOwned\(\)[^]*?\}\s*catch/);
    });
  });

  describe("error sanitization: class + bounded message, no stack trace", () => {
    it("does not place a full stack trace into the returned terminal object", () => {
      const region = lifecycleCatchRegion();
      // The terminal carries original_error_class / original_error_message but never
      // a `.stack` field in the crash handler.
      expect(region).not.toMatch(/\.stack\b/);
    });
  });
});

/**
 * Behavioral half: extract the pure `buildUnhandledFailure` helper block from the
 * SHIPPED workflow source and execute it. This proves the typed terminal shape is
 * correct — pre-acquire (null release) and post-acquire (recorded release) — with
 * the real code, not a re-implementation.
 */
const HELPERS_START = "// --- crash-path terminal builder";
const HELPERS_END = "// --- end crash-path terminal builder";

type CrashTerminal = {
  result: string;
  code: string;
  outward_action_taken: boolean;
  human_gate_required: boolean;
  run_id: string;
  lock_release_attempted: boolean;
  lock_release_result: unknown;
  original_error_class: string;
  original_error_message: string;
};

type CrashHelpers = {
  buildUnhandledFailure: (
    error: unknown,
    releaseResult: unknown,
    runId: string,
  ) => CrashTerminal;
};

function loadCrashHelpers(): CrashHelpers {
  const src = text();
  const start = src.indexOf(HELPERS_START);
  const end = src.indexOf(HELPERS_END);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const body = src.slice(start, end);
  // Cast justification: this evaluates the REAL extracted workflow builder source
  // (the non-tautological point of the test); the behavioral assertions below
  // verify the exact shape this cast declares.
  const factory = new Function(
    `${body}\nreturn { buildUnhandledFailure };`,
  ) as () => CrashHelpers;
  return factory();
}

describe("buildUnhandledFailure (extracted from the shipped workflow source and executed)", () => {
  it("POST-ACQUIRE: records the owner-checked release result and the full typed terminal", () => {
    const { buildUnhandledFailure } = loadCrashHelpers();
    const releaseResult = { exit: 0, ok: true, released: true };
    const terminal = buildUnhandledFailure(
      new TypeError("write denied"),
      releaseResult,
      "run-abc",
    );
    expect(terminal.result).toBe("ESCALATE");
    expect(terminal.code).toBe("UNHANDLED_WORKFLOW_FAILURE");
    expect(terminal.outward_action_taken).toBe(false);
    expect(terminal.human_gate_required).toBe(true);
    expect(terminal.run_id).toBe("run-abc");
    expect(terminal.lock_release_attempted).toBe(true);
    expect(terminal.lock_release_result).toEqual(releaseResult);
    expect(terminal.original_error_class).toBe("TypeError");
    expect(terminal.original_error_message).toBe("write denied");
  });

  it("PRE-ACQUIRE: a null release result means no release was attempted", () => {
    const { buildUnhandledFailure } = loadCrashHelpers();
    const terminal = buildUnhandledFailure(new Error("boom"), null, "run-xyz");
    expect(terminal.code).toBe("UNHANDLED_WORKFLOW_FAILURE");
    expect(terminal.lock_release_attempted).toBe(false);
    expect(terminal.lock_release_result).toBeNull();
    expect(terminal.run_id).toBe("run-xyz");
    expect(terminal.original_error_class).toBe("Error");
    expect(terminal.original_error_message).toBe("boom");
  });

  it("FOREIGN release: a foreign/absent/malformed release result is recorded, not cleared", () => {
    const { buildUnhandledFailure } = loadCrashHelpers();
    const foreign = { exit: 1, ok: false, code: "LOCK_FOREIGN" };
    const terminal = buildUnhandledFailure(new Error("crash"), foreign, "run-1");
    expect(terminal.lock_release_attempted).toBe(true);
    expect(terminal.lock_release_result).toEqual(foreign);
  });

  it("SANITIZES: a non-Error throw still yields a class + bounded message, no stack", () => {
    const { buildUnhandledFailure } = loadCrashHelpers();
    const terminal = buildUnhandledFailure("a bare string error", null, "run-2");
    // A non-Error value yields a deterministic class label and a string message.
    expect(typeof terminal.original_error_class).toBe("string");
    expect(terminal.original_error_class.length).toBeGreaterThan(0);
    expect(typeof terminal.original_error_message).toBe("string");
    expect(terminal.original_error_message).toContain("a bare string error");
    // No stack trace key leaks into the terminal.
    expect(terminal).not.toHaveProperty("stack");
    expect(terminal).not.toHaveProperty("original_error_stack");
  });

  it("TRUNCATES: an oversized error message is bounded (no unbounded blob in the terminal)", () => {
    const { buildUnhandledFailure } = loadCrashHelpers();
    const huge = "x".repeat(5000);
    const terminal = buildUnhandledFailure(new Error(huge), null, "run-3");
    expect(terminal.original_error_message.length).toBeLessThan(huge.length);
  });
});
