import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Launcher tests: drive the REAL `scripts/launch-workflow.mjs` as a child
 * process inside OS-temp sandboxes (the same precedent as
 * src/cli/resolver.integration.test.ts, which tests scripts/run-forge-cli.mjs
 * this way — vitest only collects src/**, and the vitest config is out of
 * fence for this ticket).
 *
 * These tests NEVER launch Claude. The launcher itself never launches Claude
 * either (asserted source-level below): the human performs the launch step —
 * that placement IS the prevention.
 *
 * The spawned launcher gets TMPDIR/TEMP/TMP pointed at a sandbox-owned fake OS
 * temp root, so every scratch dir it creates is isolated to this test run and
 * the unsafe-temp-root scenarios are reproducible.
 */

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LAUNCHER = path.join(REPO_ROOT, "scripts", "launch-workflow.mjs");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA_RE = /^[0-9a-f]{40}$/;

// The leading byte recorded on every artifact observed in the live runs
// (U+F03A) — built from its code point so this test source stays ASCII-clean.
const F03A = String.fromCharCode(0xf03a);
// The HISTORICAL artifact corpus that motivated this epic (live runs, 2026-06):
// mid-name `_out_` / `_err_` pairs and the U+F03A-prefixed shape. The scan must
// detect every observed shape — a scan that misses these reports falsely clean.
const HISTORICAL_TEMP_ARTIFACTS = [
  "TEMPfg_out_lp.txt",
  "TEMPfg_err_lp.txt",
  `${F03A}TEMPfv_out.txt`,
];

type LauncherRun = { status: number | null; stdout: string; stderr: string };

type ScanRecord = {
  session_repo: string[];
  target_repo: string[];
  launch_cwd: string[];
};

type PrepareOutput = {
  ok: boolean;
  phase: string;
  run_id: string;
  session_id: string;
  scratch_cwd: string;
  os_temp_root: string;
  evidence_paths: { scratch: string; archive: string };
  workflow_args: {
    repoRoot: string;
    epic: string;
    forgeBin: string;
    runId: string;
    sessionId: string;
    scratchCwd: string;
  };
  pre_scan: ScanRecord;
  launch_instruction: string[];
  prevention_claim: string;
};

type Evidence = {
  schema: string;
  run_id: string;
  session_id: string;
  os_temp_root: string;
  launch_cwd: string;
  session_repo: { root: string; head: string; branch: string };
  target_repo: { root: string; head: string; branch: string };
  workflow_args: PrepareOutput["workflow_args"];
  pre_scan: ScanRecord;
  post_scan: ScanRecord | null;
  cleanup: { note: string } | null;
};

type FailureOutput = { ok: boolean; code: string; error: string };

let sandbox: string;
let fakeTmp: string;
let sessionRepo: string;
let targetRepo: string;
let epicDir: string;
let sessionHead: string;
let targetHead: string;

// Shared across the sequential prepare → post-scan → cleanup flow below.
let prepared: PrepareOutput;

function gitIn(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
}

function freshRepo(name: string): string {
  const repo = path.join(sandbox, name);
  fs.mkdirSync(repo, { recursive: true });
  gitIn(repo, "init", "-q");
  gitIn(repo, "config", "user.email", "test@forge.invalid");
  gitIn(repo, "config", "user.name", "Forge Test");
  gitIn(repo, "config", "commit.gpgsign", "false");
  gitIn(repo, "checkout", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "seed.txt"), "seed\n");
  gitIn(repo, "add", "seed.txt");
  gitIn(repo, "commit", "-q", "-m", "baseline");
  return repo;
}

function runLauncher(args: string[], envOverrides: Record<string, string> = {}): LauncherRun {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TMPDIR: fakeTmp,
    TEMP: fakeTmp,
    TMP: fakeTmp,
    ...envOverrides,
  };
  // Deterministic CLI resolution inside the launcher (PATH → pnpm local
  // fallback), regardless of any developer-machine FORGE_BIN override.
  delete env.FORGE_BIN;
  const result = spawnSync(process.execPath, [LAUNCHER, ...args], { encoding: "utf8", env });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function lowerPosix(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

function readEvidence(runId: string): Evidence {
  const file = path.join(sessionRepo, ".forge", "launch-evidence", `${runId}.json`);
  // Cast justification: trust-boundary parse of the launcher's own evidence
  // artifact; every field the cast declares is asserted behaviorally below.
  return JSON.parse(fs.readFileSync(file, "utf8")) as Evidence;
}

beforeAll(() => {
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "forge-launch-wf-test-")));
  fakeTmp = path.join(sandbox, "fake-os-temp");
  fs.mkdirSync(fakeTmp, { recursive: true });
  sessionRepo = freshRepo("session-repo");
  targetRepo = freshRepo("target-repo");
  epicDir = path.join(targetRepo, "docs", "epics", "demo-epic");
  fs.mkdirSync(epicDir, { recursive: true });
  // A pre-existing harness scratch artifact in the TARGET repo: the PRE-run
  // scan must record it (the scans are evidence, not gates).
  fs.writeFileSync(path.join(targetRepo, "TEMP_pre_existing_out"), "harness scratch\n");
  // Plant the historical corpus shapes too — the scan is calibrated to the
  // OBSERVED artifacts, not just the terminal `_out.txt`/`_err.txt` form.
  for (const name of HISTORICAL_TEMP_ARTIFACTS) {
    fs.writeFileSync(path.join(targetRepo, name), "observed-corpus scratch\n");
  }
  sessionHead = gitIn(sessionRepo, "rev-parse", "HEAD").trim();
  targetHead = gitIn(targetRepo, "rev-parse", "HEAD").trim();
}, 120_000);

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("launch-workflow.mjs prepare", () => {
  it(
    "creates a per-run Forge-owned OS-temp scratch cwd and emits the launch instruction + complete workflow args",
    () => {
      const run = runLauncher([
        "prepare",
        "--session-repo",
        sessionRepo,
        "--target-repo",
        targetRepo,
        "--epic",
        epicDir,
      ]);
      expect(run.status, run.stderr || run.stdout).toBe(0);
      // Cast justification: trust-boundary parse of the launcher's stdout
      // contract; every field is asserted below.
      prepared = JSON.parse(run.stdout) as PrepareOutput;

      expect(prepared.ok).toBe(true);
      expect(prepared.phase).toBe("prepare");

      // Run identity is minted by the launcher (the workflow never mints it).
      expect(prepared.run_id).toMatch(UUID_RE);
      expect(prepared.session_id).toMatch(UUID_RE);
      expect(prepared.run_id).not.toBe(prepared.session_id);

      // Per-run, Forge-owned, namespaced by run identity, STRICTLY under the
      // OS temp root.
      expect(path.basename(prepared.scratch_cwd)).toBe(`forge-launch-${prepared.run_id}`);
      expect(lowerPosix(prepared.scratch_cwd).startsWith(`${lowerPosix(fakeTmp)}/`)).toBe(true);
      expect(fs.existsSync(prepared.scratch_cwd)).toBe(true);

      // Absolute paths everywhere; the scratch cwd sits outside both repos.
      expect(path.isAbsolute(prepared.workflow_args.repoRoot)).toBe(true);
      expect(path.isAbsolute(prepared.workflow_args.epic)).toBe(true);
      expect(path.isAbsolute(prepared.workflow_args.scratchCwd)).toBe(true);
      expect(lowerPosix(prepared.scratch_cwd).startsWith(`${lowerPosix(targetRepo)}/`)).toBe(false);
      expect(lowerPosix(prepared.scratch_cwd).startsWith(`${lowerPosix(sessionRepo)}/`)).toBe(false);

      // The complete workflow args, scratch-cwd expectation included.
      expect(lowerPosix(prepared.workflow_args.repoRoot)).toBe(lowerPosix(targetRepo));
      expect(lowerPosix(prepared.workflow_args.epic)).toBe(lowerPosix(epicDir));
      expect(prepared.workflow_args.runId).toBe(prepared.run_id);
      expect(prepared.workflow_args.sessionId).toBe(prepared.session_id);
      expect(prepared.workflow_args.scratchCwd).toBe(prepared.scratch_cwd);
      expect(prepared.workflow_args.forgeBin).toContain("dist/cli.js");

      // Evidence written to gitignored locations: the scratch cwd AND the
      // session repo's .forge/launch-evidence archive.
      expect(fs.existsSync(path.join(prepared.scratch_cwd, "forge-launch-evidence.json"))).toBe(true);
      const evidence = readEvidence(prepared.run_id);
      expect(evidence.schema).toBe("forge-launch-evidence/v1");
      expect(evidence.run_id).toBe(prepared.run_id);
      expect(evidence.session_repo.head).toBe(sessionHead);
      expect(evidence.session_repo.head).toMatch(SHA_RE);
      expect(evidence.target_repo.head).toBe(targetHead);
      expect(evidence.session_repo.branch).toBe("main");
      expect(evidence.target_repo.branch).toBe("main");
      expect(lowerPosix(evidence.launch_cwd)).toBe(lowerPosix(prepared.scratch_cwd));

      // PRE-run TEMP* scan of all three locations, recorded.
      expect(evidence.pre_scan.target_repo).toContain("TEMP_pre_existing_out");
      expect(evidence.pre_scan.session_repo).toEqual([]);
      expect(evidence.pre_scan.launch_cwd).toEqual([]);

      // The exact launch instruction: start claude FROM the scratch cwd; the
      // launcher never starts it itself.
      const instruction = prepared.launch_instruction.join("\n");
      expect(instruction).toContain(prepared.scratch_cwd);
      expect(instruction.toLowerCase()).toContain("claude");
      expect(instruction).toContain("post-scan");
      expect(instruction).toContain("cleanup");

      // The prevention claim is launch-cwd placement — never cleanup.
      expect(prepared.prevention_claim).toContain("launch-cwd placement");
      expect(prepared.prevention_claim).toContain("hygiene");
    },
    120_000,
  );

  it("the TEMP* scan detects the full historical artifact corpus (mid-name _out_/_err_ pairs and the U+F03A-prefixed shape)", () => {
    expect(prepared, "prepare must have succeeded first").toBeDefined();
    for (const name of HISTORICAL_TEMP_ARTIFACTS) {
      expect(prepared.pre_scan.target_repo, `scan must detect observed shape ${JSON.stringify(name)}`).toContain(
        name,
      );
    }
  });

  it(
    "fails closed (creating nothing) when the OS temp root resolves inside a repo working tree",
    () => {
      const tmpInsideRepo = path.join(targetRepo, "temp-inside");
      fs.mkdirSync(tmpInsideRepo, { recursive: true });
      const run = runLauncher(
        ["prepare", "--session-repo", sessionRepo, "--target-repo", targetRepo, "--epic", epicDir],
        { TMPDIR: tmpInsideRepo, TEMP: tmpInsideRepo, TMP: tmpInsideRepo },
      );
      expect(run.status).toBe(1);
      // Cast justification: trust-boundary parse of the launcher's typed
      // failure contract, asserted below.
      const failure = JSON.parse(run.stdout) as FailureOutput;
      expect(failure.ok).toBe(false);
      expect(failure.code).toBe("SCRATCH_CWD_UNSAFE");
      // Nothing was created inside the unsafe temp root.
      expect(fs.readdirSync(tmpInsideRepo)).toEqual([]);
    },
    60_000,
  );

  it("rejects relative repo paths (usage error)", () => {
    const run = runLauncher([
      "prepare",
      "--session-repo",
      sessionRepo,
      "--target-repo",
      "relative/target",
      "--epic",
      epicDir,
    ]);
    expect(run.status).toBe(2);
  });

  it("rejects a missing --epic (usage error)", () => {
    const run = runLauncher(["prepare", "--session-repo", sessionRepo, "--target-repo", targetRepo]);
    expect(run.status).toBe(2);
  });

  it("rejects an unknown phase (usage error)", () => {
    const run = runLauncher(["launch-claude"]);
    expect(run.status).toBe(2);
  });

  it("fails typed when the epic path does not exist", () => {
    const run = runLauncher([
      "prepare",
      "--session-repo",
      sessionRepo,
      "--target-repo",
      targetRepo,
      "--epic",
      path.join(targetRepo, "docs", "epics", "no-such-epic"),
    ]);
    expect(run.status).toBe(1);
    // Cast justification: trust-boundary parse of the typed failure contract.
    const failure = JSON.parse(run.stdout) as FailureOutput;
    expect(failure.code).toBe("EPIC_NOT_FOUND");
  });
});

describe("launch-workflow.mjs post-scan", () => {
  it(
    "re-scans the session repo, target repo, and launch cwd, and records the findings in the evidence",
    () => {
      expect(prepared, "prepare must have succeeded first").toBeDefined();
      // Plant a harness-style scratch pair in the LAUNCH cwd after prepare —
      // the post-run scan must find it there.
      fs.writeFileSync(path.join(prepared.scratch_cwd, "TEMP_planted_err"), "stderr scratch\n");

      const run = runLauncher(["post-scan", "--session-repo", sessionRepo, "--run-id", prepared.run_id]);
      expect(run.status, run.stderr || run.stdout).toBe(0);
      // Cast justification: trust-boundary parse of the launcher's stdout
      // contract; fields asserted below.
      const parsed = JSON.parse(run.stdout) as {
        ok: boolean;
        phase: string;
        clean: boolean;
        post_scan: ScanRecord;
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.phase).toBe("post-scan");
      expect(parsed.clean).toBe(false);
      expect(parsed.post_scan.launch_cwd).toContain("TEMP_planted_err");
      expect(parsed.post_scan.target_repo).toContain("TEMP_pre_existing_out");
      // The historical corpus keeps the post-run scan honest — never falsely
      // clean while any observed artifact shape is present.
      for (const name of HISTORICAL_TEMP_ARTIFACTS) {
        expect(parsed.post_scan.target_repo, `post-scan must detect ${JSON.stringify(name)}`).toContain(name);
      }
      expect(parsed.post_scan.session_repo).toEqual([]);

      const evidence = readEvidence(prepared.run_id);
      expect(evidence.post_scan).not.toBeNull();
      expect(evidence.post_scan?.launch_cwd).toContain("TEMP_planted_err");
    },
    60_000,
  );

  it("fails typed for an unknown run id", () => {
    const run = runLauncher([
      "post-scan",
      "--session-repo",
      sessionRepo,
      "--run-id",
      "00000000-0000-0000-0000-000000000000",
    ]);
    expect(run.status).toBe(1);
    // Cast justification: trust-boundary parse of the typed failure contract.
    const failure = JSON.parse(run.stdout) as FailureOutput;
    expect(failure.code).toBe("EVIDENCE_NOT_FOUND");
  });
});

describe("launch-workflow.mjs cleanup", () => {
  it(
    "removes ONLY the Forge-owned launch-cwd scratch dir and states that cleanup is hygiene, not prevention",
    () => {
      expect(prepared, "prepare must have succeeded first").toBeDefined();
      const run = runLauncher(["cleanup", "--session-repo", sessionRepo, "--run-id", prepared.run_id]);
      expect(run.status, run.stderr || run.stdout).toBe(0);
      // Cast justification: trust-boundary parse of the launcher's stdout
      // contract; fields asserted below.
      const parsed = JSON.parse(run.stdout) as {
        ok: boolean;
        phase: string;
        note: string;
        prevention_claim: string;
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.phase).toBe("cleanup");

      // The Forge-owned scratch dir is gone …
      expect(fs.existsSync(prepared.scratch_cwd)).toBe(false);
      // … and NOTHING else was touched: the target repo (and its pre-existing
      // TEMP artifact — not Forge-owned launch scratch) is intact.
      expect(fs.existsSync(path.join(targetRepo, "TEMP_pre_existing_out"))).toBe(true);
      expect(fs.existsSync(path.join(targetRepo, "seed.txt"))).toBe(true);

      // Cleanup is presented as hygiene; the prevention claim stays launch-cwd
      // placement.
      expect(parsed.note).toContain("hygiene");
      expect(parsed.note).toContain("launch-cwd placement");
      expect(parsed.prevention_claim).toContain("launch-cwd placement");

      // The archived evidence survives the scratch removal and records cleanup.
      const evidence = readEvidence(prepared.run_id);
      expect(evidence.cleanup).not.toBeNull();
      expect(evidence.cleanup?.note).toContain("hygiene");
    },
    60_000,
  );

  it("refuses to delete a directory it does not own (tampered evidence)", () => {
    const fakeRunId = "11111111-1111-1111-1111-111111111111";
    const evidenceDir = path.join(sessionRepo, ".forge", "launch-evidence");
    fs.mkdirSync(evidenceDir, { recursive: true });
    const tampered = {
      schema: "forge-launch-evidence/v1",
      run_id: fakeRunId,
      session_id: fakeRunId,
      os_temp_root: fakeTmp.replace(/\\/g, "/"),
      // Points OUTSIDE the Forge-owned namespace — at the target repo itself.
      launch_cwd: targetRepo.replace(/\\/g, "/"),
      session_repo: { root: sessionRepo.replace(/\\/g, "/"), head: sessionHead, branch: "main" },
      target_repo: { root: targetRepo.replace(/\\/g, "/"), head: targetHead, branch: "main" },
      pre_scan: { session_repo: [], target_repo: [], launch_cwd: [] },
      post_scan: null,
      cleanup: null,
    };
    fs.writeFileSync(path.join(evidenceDir, `${fakeRunId}.json`), JSON.stringify(tampered, null, 2));

    const run = runLauncher(["cleanup", "--session-repo", sessionRepo, "--run-id", fakeRunId]);
    expect(run.status).toBe(1);
    // Cast justification: trust-boundary parse of the typed failure contract.
    const failure = JSON.parse(run.stdout) as FailureOutput;
    expect(failure.code).toBe("CLEANUP_REFUSED_NOT_FORGE_OWNED");
    // Nothing was deleted.
    expect(fs.existsSync(targetRepo)).toBe(true);
    expect(fs.existsSync(path.join(targetRepo, "seed.txt"))).toBe(true);
  });
});

describe("launch-workflow.mjs source contract", () => {
  const source = (): string => fs.readFileSync(LAUNCHER, "utf8");

  it("never spawns claude (the human performs the launch — that placement IS the prevention)", () => {
    expect(source()).not.toMatch(/spawn(?:Sync)?\(\s*["'`]claude/i);
  });

  it("gets repo facts hook-free via the forge CLI resolver, never by shelling git", () => {
    const src = source();
    expect(src).toContain("run-forge-cli.mjs");
    expect(src).toContain("repo");
    expect(src).not.toMatch(/spawnSync\(\s*["'`]git["'`]/);
    expect(src).not.toMatch(/execFileSync\(\s*["'`]git["'`]/);
  });
});

/**
 * Behavioral half: extract the pure cleanup-teardown error classifier from the
 * SHIPPED launcher source and execute it. This proves the busy/locked → typed
 * `CLEANUP_BLOCKED` mapping (and the no-masking invariant for any other code)
 * with the real code, not a re-implementation — and is unit-testable WITHOUT a
 * live held directory (the EPERM was already observed in the F1/F2 sequence).
 */
const CLASSIFIER_START = "// --- cleanup-teardown error classifier";
const CLASSIFIER_END = "// --- end cleanup-teardown error classifier";

type CleanupBlocked = { ok: false; code: string; error: string };

type CleanupHelpers = {
  classifyCleanupTeardownError: (
    error: unknown,
    scratchPosix: string,
  ) => CleanupBlocked | null;
};

function loadCleanupHelpers(): CleanupHelpers {
  const src = fs.readFileSync(LAUNCHER, "utf8");
  const start = src.indexOf(CLASSIFIER_START);
  const end = src.indexOf(CLASSIFIER_END);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const body = src.slice(start, end);
  // Cast justification: this evaluates the REAL extracted launcher classifier
  // source (the non-tautological point of the test); the behavioral assertions
  // below verify the exact shape this cast declares.
  const factory = new Function(
    `${body}\nreturn { classifyCleanupTeardownError };`,
  ) as () => CleanupHelpers;
  return factory();
}

describe("classifyCleanupTeardownError (extracted from the shipped launcher source and executed)", () => {
  const GUIDANCE = "Close the scratch-launched Claude session, then re-run cleanup.";
  const SCRATCH = "/tmp/forge-launch-abc/scratch";

  it("maps an EPERM teardown failure to a typed CLEANUP_BLOCKED carrying the path + guidance", () => {
    const { classifyCleanupTeardownError } = loadCleanupHelpers();
    const err = Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    const blocked = classifyCleanupTeardownError(err, SCRATCH);
    expect(blocked).not.toBeNull();
    expect(blocked?.ok).toBe(false);
    expect(blocked?.code).toBe("CLEANUP_BLOCKED");
    expect(blocked?.error).toContain(SCRATCH);
    expect(blocked?.error).toContain(GUIDANCE);
  });

  it("maps an EBUSY teardown failure to a typed CLEANUP_BLOCKED carrying the path + guidance", () => {
    const { classifyCleanupTeardownError } = loadCleanupHelpers();
    const err = Object.assign(new Error("resource busy or locked"), { code: "EBUSY" });
    const blocked = classifyCleanupTeardownError(err, SCRATCH);
    expect(blocked).not.toBeNull();
    expect(blocked?.code).toBe("CLEANUP_BLOCKED");
    expect(blocked?.error).toContain(SCRATCH);
    expect(blocked?.error).toContain(GUIDANCE);
  });

  it("does NOT mask a non-busy failure: any other error code signals not-handled (null)", () => {
    const { classifyCleanupTeardownError } = loadCleanupHelpers();
    const enoent = Object.assign(new Error("no such file"), { code: "ENOENT" });
    expect(classifyCleanupTeardownError(enoent, SCRATCH)).toBeNull();
    const noCode = new Error("plain failure with no code");
    expect(classifyCleanupTeardownError(noCode, SCRATCH)).toBeNull();
    const notError = "a thrown string, not an Error";
    expect(classifyCleanupTeardownError(notError, SCRATCH)).toBeNull();
  });
});
