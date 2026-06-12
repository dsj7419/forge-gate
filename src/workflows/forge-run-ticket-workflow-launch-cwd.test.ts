import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");

/**
 * Protocol-lock test: forge-run-ticket workflow ↔ fail-closed LAUNCH-CWD gate.
 *
 * The harness Bash output-capture wrapper writes TEMP*_out / TEMP*_err scratch
 * pairs into the subagent process cwd — the directory the `claude` session was
 * STARTED from — below charter (L2) and workflow command-shape control. The
 * live-proven prevention is launch-cwd placement: the run is launched from a
 * Forge-owned OS-temp scratch cwd, and the workflow enforces that contract
 * FAIL-CLOSED before any mutation.
 *
 * This suite is NON-TAUTOLOGICAL: it asserts (a) the PRESENCE of the gate
 * wiring (the strict launcher-declared `scratchCwd` expectation in args, the
 * non-git bridge probe of the observed launch cwd, the Windows-aware
 * normalized comparison, the dedicated typed escalate code), (b) the ORDERING
 * — the entire gate, probe included, runs BEFORE the atomic lock acquire,
 * BEFORE checkpoint capture, and BEFORE active-ticket emission, so an unsafe
 * launch cwd can never acquire the lock or mutate anything, and (c) the
 * BEHAVIOR of the real comparison code — the pure helper block is extracted
 * from the shipped workflow source and EXECUTED here against safe and unsafe
 * launch shapes (Windows backslash/case variants included). If a future edit
 * drops the gate, reorders it after the acquire, or weakens the comparison,
 * this suite goes red.
 *
 * Anchors target the actual call sites (template-literal text), not doc
 * comments, mirroring src/workflows/forge-run-ticket-workflow-lock.test.ts.
 */

const WORKFLOW_FILE = join(REPO_ROOT, "workflows", "forge-run-ticket.workflow.js");

const text = (): string => readFileSync(WORKFLOW_FILE, "utf8");

// The actual atomic-acquire CALL SITE (template-literal text), not the doc
// comments earlier in the file that merely mention `forge lock acquire`.
const ACQUIRE_CALL = '${forgeBin} lock acquire';
// The lock-ownership flag flips true ONLY on a successful acquire.
const ACQUIRED_TRUE = "acquired = true";
// Checkpoint capture and Core-owned active-ticket emission (mutation-adjacent).
const CHECKPOINT_ASSIGN = "const checkpointBase";
const ACTIVE_TICKET = "activeTicketWritten";
// The dedicated typed escalation code for an unsafe/unverifiable launch cwd.
const GATE_CODE = "PREFLIGHT_LAUNCH_CWD_UNSAFE";
const GATE_ESCALATE = `escalate("${GATE_CODE}"`;

describe("forge-run-ticket workflow ↔ fail-closed launch-cwd gate", () => {
  describe("present: strict launcher-declared scratch-cwd expectation", () => {
    const REQUIRED_TOKENS: readonly string[] = [
      // The expectation arrives via args (launcher-declared; never minted here).
      "ARGS.scratchCwd",
      // The dedicated typed escalation code.
      "PREFLIGHT_LAUNCH_CWD_UNSAFE",
      // The non-git bridge probe and the pure comparison helpers.
      "probeLaunchCwd",
      "evaluateLaunchCwd",
      "normalizeLaunchPath",
      // The probe observes the real process cwd and the real OS temp root.
      "process.cwd()",
      "tmpdir",
      "realpathSync",
    ];

    for (const token of REQUIRED_TOKENS) {
      it(`contains "${token}"`, () => {
        expect(text()).toContain(token);
      });
    }

    it("treats a missing scratchCwd expectation as required (strict, fail-closed)", () => {
      expect(text()).toMatch(/args\.scratchCwd[^]*?required/i);
    });

    it("every launch-cwd escalation is a terminating `return await escalate` (fail-closed)", () => {
      const src = text();
      const all = src.match(/escalate\("PREFLIGHT_LAUNCH_CWD_UNSAFE"/g) ?? [];
      const returned = src.match(/return await escalate\("PREFLIGHT_LAUNCH_CWD_UNSAFE"/g) ?? [];
      // Missing expectation + undecidable probe + unsafe verdict — at least the
      // missing-arg and unsafe-verdict paths must exist, and EVERY one returns.
      expect(all.length).toBeGreaterThanOrEqual(2);
      expect(returned.length).toBe(all.length);
    });
  });

  describe("ordering: the whole gate runs before lock acquire / checkpoint / active-ticket", () => {
    it("the gate (first mention through last escalate) precedes the atomic lock-acquire call site", () => {
      const src = text();
      const acquireIdx = src.indexOf(ACQUIRE_CALL);
      const gateFirstIdx = src.indexOf(GATE_CODE);
      const gateLastEscalateIdx = src.lastIndexOf(GATE_ESCALATE);
      expect(acquireIdx).toBeGreaterThan(-1);
      expect(gateFirstIdx).toBeGreaterThan(-1);
      expect(gateLastEscalateIdx).toBeGreaterThan(-1);
      expect(gateFirstIdx).toBeLessThan(acquireIdx);
      expect(gateLastEscalateIdx).toBeLessThan(acquireIdx);
    });

    it("an unsafe launch can never set the lock-ownership flag (gate precedes `acquired = true`)", () => {
      const src = text();
      const acquiredTrueIdx = src.indexOf(ACQUIRED_TRUE);
      const gateLastEscalateIdx = src.lastIndexOf(GATE_ESCALATE);
      expect(acquiredTrueIdx).toBeGreaterThan(-1);
      expect(gateLastEscalateIdx).toBeLessThan(acquiredTrueIdx);
    });

    it("the probe and the verdict evaluation both run before the acquire call site", () => {
      const src = text();
      const acquireIdx = src.indexOf(ACQUIRE_CALL);
      const probeCallIdx = src.indexOf("await probeLaunchCwd()");
      const evaluateCallIdx = src.indexOf("evaluateLaunchCwd(observedLaunch");
      expect(probeCallIdx).toBeGreaterThan(-1);
      expect(evaluateCallIdx).toBeGreaterThan(-1);
      expect(probeCallIdx).toBeLessThan(acquireIdx);
      expect(evaluateCallIdx).toBeLessThan(acquireIdx);
    });

    it("the gate precedes checkpoint capture and active-ticket emission", () => {
      const src = text();
      const gateLastEscalateIdx = src.lastIndexOf(GATE_ESCALATE);
      const checkpointIdx = src.indexOf(CHECKPOINT_ASSIGN);
      const activeTicketIdx = src.indexOf(ACTIVE_TICKET);
      expect(checkpointIdx).toBeGreaterThan(-1);
      expect(activeTicketIdx).toBeGreaterThan(-1);
      expect(gateLastEscalateIdx).toBeLessThan(checkpointIdx);
      expect(gateLastEscalateIdx).toBeLessThan(activeTicketIdx);
    });
  });

  describe("probe shape: non-git, bridge-typed, observes the launch cwd as anchored", () => {
    it("the probe dispatches the typed forge-core-runner bridge with a bare `node -e` command", () => {
      const src = text();
      // The probe is schema'd like every other bridge call (runCore + probe ≥ 2).
      const bridgeDispatches = src.match(/agentType: "forge-core-runner"/g) ?? [];
      expect(bridgeDispatches.length).toBeGreaterThanOrEqual(2);
      expect(src).toMatch(/probeLaunchCwd[^]*?node -e/);
    });

    it("the probe explicitly forbids cd-ing first (the observation is the point)", () => {
      expect(text()).toContain("Do NOT cd");
    });
  });

  describe("Windows-aware comparison (separator + case normalization)", () => {
    it("normalizes backslashes to forward slashes", () => {
      expect(text()).toContain(String.raw`.replace(/\\/g, "/")`);
    });

    it("case-folds before comparing", () => {
      expect(text()).toContain(".toLowerCase()");
    });
  });
});

/**
 * Behavioral half: extract the pure launch-cwd helper block from the SHIPPED
 * workflow source and execute it. This proves the safe path passes and each
 * unsafe shape fails — with the real code, not a re-implementation.
 */
const HELPERS_START = "// --- launch-cwd gate helpers";
const HELPERS_END = "// --- end launch-cwd gate helpers";

type LaunchCwdVerdict = {
  safe: boolean;
  checks: {
    matches_expectation: boolean;
    under_os_temp_root: boolean;
    outside_target_repo: boolean;
  };
};

type LaunchHelpers = {
  normalizeLaunchPath: (p: string) => string;
  evaluateLaunchCwd: (
    observed: { cwd: string; tmpdir: string },
    expectation: { scratchCwd: string; repoRoot: string },
  ) => LaunchCwdVerdict;
};

function loadLaunchHelpers(): LaunchHelpers {
  const src = text();
  const start = src.indexOf(HELPERS_START);
  const end = src.indexOf(HELPERS_END);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const body = src.slice(start, end);
  // Cast justification: this evaluates the REAL extracted workflow helper
  // source (the non-tautological point of the test); the behavioral assertions
  // below verify the exact shape this cast declares.
  const factory = new Function(
    `${body}\nreturn { normalizeLaunchPath, evaluateLaunchCwd };`,
  ) as () => LaunchHelpers;
  return factory();
}

describe("launch-cwd gate helpers (extracted from the shipped workflow source and executed)", () => {
  it("normalizeLaunchPath: Windows backslashes, trailing separators, and case all normalize", () => {
    const { normalizeLaunchPath } = loadLaunchHelpers();
    expect(normalizeLaunchPath("C:\\Users\\X\\AppData\\Local\\Temp\\forge-launch-r1\\")).toBe(
      "c:/users/x/appdata/local/temp/forge-launch-r1",
    );
    expect(normalizeLaunchPath("/tmp/forge-launch-r1/")).toBe("/tmp/forge-launch-r1");
  });

  it("SAFE: observed cwd equals the declared scratch cwd, under the OS temp root, outside the repo (Windows variants)", () => {
    const { evaluateLaunchCwd } = loadLaunchHelpers();
    const verdict = evaluateLaunchCwd(
      { cwd: "C:\\Users\\X\\AppData\\Local\\Temp\\forge-launch-r1", tmpdir: "C:\\Users\\X\\AppData\\Local\\Temp" },
      { scratchCwd: "c:/users/x/appdata/local/temp/forge-launch-r1", repoRoot: "D:\\Projects\\target" },
    );
    expect(verdict.checks).toEqual({
      matches_expectation: true,
      under_os_temp_root: true,
      outside_target_repo: true,
    });
    expect(verdict.safe).toBe(true);
  });

  it("SAFE: POSIX shape", () => {
    const { evaluateLaunchCwd } = loadLaunchHelpers();
    const verdict = evaluateLaunchCwd(
      { cwd: "/tmp/forge-launch-r1", tmpdir: "/tmp" },
      { scratchCwd: "/tmp/forge-launch-r1", repoRoot: "/home/u/project" },
    );
    expect(verdict.safe).toBe(true);
  });

  it("UNSAFE: observed cwd differs from the declared scratch cwd", () => {
    const { evaluateLaunchCwd } = loadLaunchHelpers();
    const verdict = evaluateLaunchCwd(
      { cwd: "C:\\Users\\X\\AppData\\Local\\Temp\\somewhere-else", tmpdir: "C:\\Users\\X\\AppData\\Local\\Temp" },
      { scratchCwd: "c:/users/x/appdata/local/temp/forge-launch-r1", repoRoot: "D:\\Projects\\target" },
    );
    expect(verdict.checks.matches_expectation).toBe(false);
    expect(verdict.safe).toBe(false);
  });

  it("UNSAFE: observed cwd inside the target repoRoot (even when the temp root sits above it)", () => {
    const { evaluateLaunchCwd } = loadLaunchHelpers();
    const verdict = evaluateLaunchCwd(
      { cwd: "C:\\Temp\\repo\\forge-launch-r1", tmpdir: "C:\\Temp" },
      { scratchCwd: "c:/temp/repo/forge-launch-r1", repoRoot: "C:\\Temp\\repo" },
    );
    expect(verdict.checks.outside_target_repo).toBe(false);
    expect(verdict.safe).toBe(false);
  });

  it("UNSAFE: the OS temp root itself is not a per-run scratch dir (must be STRICTLY under it)", () => {
    const { evaluateLaunchCwd } = loadLaunchHelpers();
    const verdict = evaluateLaunchCwd(
      { cwd: "C:\\Users\\X\\AppData\\Local\\Temp", tmpdir: "C:\\Users\\X\\AppData\\Local\\Temp" },
      { scratchCwd: "c:/users/x/appdata/local/temp", repoRoot: "D:\\Projects\\target" },
    );
    expect(verdict.checks.under_os_temp_root).toBe(false);
    expect(verdict.safe).toBe(false);
  });

  it("UNSAFE: an empty observed cwd never matches", () => {
    const { evaluateLaunchCwd } = loadLaunchHelpers();
    const verdict = evaluateLaunchCwd(
      { cwd: "", tmpdir: "/tmp" },
      { scratchCwd: "", repoRoot: "/home/u/project" },
    );
    expect(verdict.safe).toBe(false);
  });
});
