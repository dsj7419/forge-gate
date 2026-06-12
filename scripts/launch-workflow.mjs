#!/usr/bin/env node
// scripts/launch-workflow.mjs — the Forge-owned OS-temp scratch LAUNCHER for
// workflow-backed ForgeGate runs (epic forge-workflow-scratch-launch-cwd).
//
// WHY THIS EXISTS (live-proven 2026-06-09): the Claude Code harness's Bash
// output-capture wrapper writes TEMP*_out / TEMP*_err scratch pairs into the
// subagent process cwd — which is the directory the `claude` SESSION was
// started from — below charter (L2) and workflow command-shape control. The
// enforceable prevention is LAUNCH-CWD PLACEMENT: start the session FROM a
// Forge-owned scratch directory under the OS temp root, so harness scratch can
// only ever land somewhere ForgeGate owns and later deletes. Starting the
// session elsewhere and changing directory later is proven ineffective (the
// session cwd is immutable mid-session and Agent/Workflow subagents anchor to
// the launch cwd).
//
// This script owns the OPERATIONAL layer only (Forge Core gains no CLI surface
// and invents no workflow metadata):
//
//   prepare   — mints the run identity (runId/sessionId), creates the per-run
//               scratch cwd under the OS temp root (namespaced by run id),
//               verifies it sits OUTSIDE every repo working tree, captures
//               hook-free repo facts (`forge repo snapshot` through
//               scripts/run-forge-cli.mjs — this script never shells git),
//               runs the PRE-run TEMP* scan of the session repo + target repo
//               + launch cwd, writes gitignored evidence (the scratch cwd and
//               the session repo's .forge/launch-evidence/), and emits the
//               exact launch instruction plus the COMPLETE workflow args JSON
//               — including the strict `scratchCwd` expectation the workflow's
//               fail-closed launch-cwd gate requires.
//   post-scan — re-scans the same three locations after the run and records
//               the result in the evidence.
//   cleanup   — removes ONLY the Forge-owned launch-cwd scratch dir (ownership
//               is verified before any delete). Cleanup is HYGIENE: the
//               prevention claim is launch-cwd placement, never this removal.
//
// The script NEVER launches Claude itself: the human starts the session from
// the scratch cwd (that placement is the human-performed prevention step), and
// no test path spawns Claude either.

import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FORGE_CLI_RESOLVER = path.join(SCRIPT_DIR, "run-forge-cli.mjs");

// The harness scratch shape this launcher scans for (the producer writes
// TEMP*_out / TEMP*_err pairs into the launch cwd).
const TEMP_ARTIFACT_RE = /^TEMP.*_(out|err)(\..*)?$/;
const SCRATCH_NAMESPACE_RE = /^forge-launch-[0-9a-f-]+$/i;

const PREVENTION_CLAIM =
  "Prevention is launch-cwd placement: the claude session must be STARTED FROM the Forge-owned " +
  "OS-temp scratch cwd. Cleanup of scratch artifacts is hygiene only; it is never the prevention mechanism.";

const USAGE = [
  "usage:",
  "  node scripts/launch-workflow.mjs prepare   --session-repo <abs> --target-repo <abs> --epic <path> [--forge-bin <cmd>]",
  "  node scripts/launch-workflow.mjs post-scan --session-repo <abs> --run-id <id>",
  "  node scripts/launch-workflow.mjs cleanup   --session-repo <abs> --run-id <id>",
].join("\n");

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function fail(code, error) {
  emit({ ok: false, code, error });
  process.exit(1);
}

function usage(detail) {
  process.stderr.write(`${detail}\n${USAGE}\n`);
  process.exit(2);
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

function toPosix(p) {
  return p.replace(/\\/g, "/");
}

function normForCompare(p) {
  return toPosix(p).replace(/\/+$/, "").toLowerCase();
}

function isContainedIn(child, parent) {
  const c = normForCompare(child);
  const p = normForCompare(parent);
  return c === p || c.startsWith(`${p}/`);
}

/** Walk up from startDir; the first ancestor (inclusive) holding a `.git` entry. */
function findEnclosingGitEntry(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Hook-free, read-only repo facts via Core's `forge repo snapshot` through the
 * deterministic CLI resolver. This launcher never shells git: every repo fact
 * comes from Core, whose git runs internally via execFileSync.
 */
function repoSnapshot(repoRoot) {
  const result = spawnSync(
    process.execPath,
    [FORGE_CLI_RESOLVER, "repo", "snapshot", "--repo-root", repoRoot],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    fail(
      "REPO_SNAPSHOT_FAILED",
      `forge repo snapshot failed for ${toPosix(repoRoot)} (exit ${String(result.status)}): ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(
      "REPO_SNAPSHOT_FAILED",
      `forge repo snapshot emitted non-JSON stdout for ${toPosix(repoRoot)}: ${result.stdout}`,
    );
  }
}

/**
 * Recursive TEMP* artifact scan. Returns sorted repo-relative (forward-slash)
 * paths of entries matching the harness scratch shape; `null` when the root
 * does not exist. Skips `.git` and `node_modules` (neither is a place the
 * harness wrapper writes its cwd-anchored scratch).
 */
function scanTempArtifacts(root) {
  if (!fs.existsSync(root)) return null;
  const findings = [];
  const walk = (absDir, relDir) => {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const rel = relDir.length === 0 ? entry.name : `${relDir}/${entry.name}`;
      if (TEMP_ARTIFACT_RE.test(entry.name)) findings.push(rel);
      if (entry.isDirectory()) walk(path.join(absDir, entry.name), rel);
    }
  };
  walk(root, "");
  return findings.sort();
}

function evidenceArchivePath(sessionRepoRoot, runId) {
  return path.join(sessionRepoRoot, ".forge", "launch-evidence", `${runId}.json`);
}

/**
 * Persist the evidence to its gitignored locations: always the session repo's
 * .forge/launch-evidence archive, plus a copy inside the scratch cwd while it
 * exists (that copy doubles as the cleanup ownership marker).
 */
function writeEvidence(evidence) {
  const archive = evidenceArchivePath(evidence.session_repo.root, evidence.run_id);
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  const bytes = `${JSON.stringify(evidence, null, 2)}\n`;
  fs.writeFileSync(archive, bytes);
  let scratchCopy = null;
  if (fs.existsSync(evidence.launch_cwd)) {
    scratchCopy = path.join(evidence.launch_cwd, "forge-launch-evidence.json");
    fs.writeFileSync(scratchCopy, bytes);
  }
  return { archive: toPosix(archive), scratch: scratchCopy === null ? null : toPosix(scratchCopy) };
}

function loadEvidence(args, phaseName) {
  const sessionRepoArg = flagValue(args, "--session-repo");
  const runId = flagValue(args, "--run-id");
  if (sessionRepoArg === undefined || runId === undefined) {
    usage(`${phaseName} requires --session-repo and --run-id`);
  }
  if (!path.isAbsolute(sessionRepoArg)) {
    usage(`${phaseName}: --session-repo must be an ABSOLUTE path`);
  }
  let sessionRepo;
  try {
    sessionRepo = fs.realpathSync(sessionRepoArg);
  } catch {
    fail("REPO_NOT_FOUND", `session repo does not exist: ${toPosix(sessionRepoArg)}`);
  }
  const archive = evidenceArchivePath(sessionRepo, runId);
  if (!fs.existsSync(archive)) {
    fail(
      "EVIDENCE_NOT_FOUND",
      `no launch evidence for run ${runId} at ${toPosix(archive)} — run prepare first`,
    );
  }
  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(archive, "utf8"));
  } catch {
    fail("EVIDENCE_MALFORMED", `launch evidence is not valid JSON: ${toPosix(archive)}`);
  }
  return { evidence, runId };
}

// --- prepare -----------------------------------------------------------------

function runPrepare(args) {
  const sessionRepoArg = flagValue(args, "--session-repo");
  const targetRepoArg = flagValue(args, "--target-repo");
  const epicArg = flagValue(args, "--epic");
  if (sessionRepoArg === undefined || targetRepoArg === undefined || epicArg === undefined) {
    usage("prepare requires --session-repo, --target-repo, and --epic");
  }
  if (!path.isAbsolute(sessionRepoArg) || !path.isAbsolute(targetRepoArg)) {
    usage("prepare: --session-repo and --target-repo must be ABSOLUTE paths");
  }

  let sessionRepo;
  try {
    sessionRepo = fs.realpathSync(sessionRepoArg);
  } catch {
    fail("REPO_NOT_FOUND", `session repo does not exist: ${toPosix(sessionRepoArg)}`);
  }
  let targetRepo;
  try {
    targetRepo = fs.realpathSync(targetRepoArg);
  } catch {
    fail("REPO_NOT_FOUND", `target repo does not exist: ${toPosix(targetRepoArg)}`);
  }

  const epicResolved = path.isAbsolute(epicArg) ? epicArg : path.join(targetRepo, epicArg);
  let epic;
  try {
    epic = fs.realpathSync(epicResolved);
  } catch {
    fail("EPIC_NOT_FOUND", `epic path does not exist: ${toPosix(epicResolved)}`);
  }

  const runId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const osTempRoot = fs.realpathSync(os.tmpdir());
  const scratchCandidate = path.join(osTempRoot, `forge-launch-${runId}`);

  // The scratch cwd must be Forge-owned OS-temp space OUTSIDE every repo
  // working tree — never inside the target repo, never inside the session
  // repo, and not under any other git worktree the OS temp root happens to
  // live in. Checked BEFORE anything is created, so an unsafe temp root
  // creates nothing.
  const enclosingGit = findEnclosingGitEntry(osTempRoot);
  if (
    enclosingGit !== null ||
    isContainedIn(scratchCandidate, targetRepo) ||
    isContainedIn(scratchCandidate, sessionRepo)
  ) {
    fail(
      "SCRATCH_CWD_UNSAFE",
      `refusing to use ${toPosix(scratchCandidate)} as the scratch launch cwd: it resolves inside a repo working tree` +
        `${enclosingGit === null ? "" : ` (git worktree at ${toPosix(enclosingGit)})`}` +
        " — point the OS temp root (%TEMP% / TMPDIR) outside every repo and retry. Nothing was created.",
    );
  }

  // Hook-free repo facts before any filesystem mutation.
  const sessionSnapshot = repoSnapshot(sessionRepo);
  const targetSnapshot = repoSnapshot(targetRepo);

  fs.mkdirSync(scratchCandidate, { recursive: true });
  const scratchCwd = fs.realpathSync(scratchCandidate);

  const preScan = {
    scanned_at_iso: new Date().toISOString(),
    session_repo: scanTempArtifacts(sessionRepo),
    target_repo: scanTempArtifacts(targetRepo),
    launch_cwd: scanTempArtifacts(scratchCwd),
  };

  const forgeBin = flagValue(args, "--forge-bin") ?? `node "${toPosix(sessionRepo)}/dist/cli.js"`;
  const workflowArgs = {
    repoRoot: toPosix(targetRepo),
    epic: toPosix(epic),
    forgeBin,
    runId,
    sessionId,
    scratchCwd: toPosix(scratchCwd),
  };

  const evidence = {
    schema: "forge-launch-evidence/v1",
    run_id: runId,
    session_id: sessionId,
    created_at_iso: new Date().toISOString(),
    os_temp_root: toPosix(osTempRoot),
    launch_cwd: toPosix(scratchCwd),
    session_repo: {
      root: toPosix(sessionRepo),
      head: sessionSnapshot.head,
      branch: sessionSnapshot.branch,
    },
    target_repo: {
      root: toPosix(targetRepo),
      head: targetSnapshot.head,
      branch: targetSnapshot.branch,
    },
    epic: toPosix(epic),
    workflow_args: workflowArgs,
    prevention_claim: PREVENTION_CLAIM,
    pre_scan: preScan,
    post_scan: null,
    cleanup: null,
  };
  const evidencePaths = writeEvidence(evidence);

  const launchInstruction = [
    `1. Open a NEW terminal (your own shell — not an agent), then: cd "${toPosix(scratchCwd)}"`,
    "2. Start Claude Code FROM that directory: `claude` — this placement IS the prevention; a session started elsewhere and cd'd later is NOT safe (the session cwd is immutable mid-session).",
    "3. Hook posture: a scratch-launched session does not load ForgeGate's project-local permissions hook — restrict the session to launch-and-prove actions only (no outward git/gh actions, no source edits, nothing outward without explicit human approval).",
    `4. In that session, invoke the Workflow tool on "${toPosix(sessionRepo)}/workflows/forge-run-ticket.workflow.js" with EXACTLY the workflow_args JSON below — the workflow's launch-cwd gate fails closed without the scratchCwd expectation.`,
    `5. After the run: node "${toPosix(sessionRepo)}/scripts/launch-workflow.mjs" post-scan --session-repo "${toPosix(sessionRepo)}" --run-id ${runId}`,
    `6. Then cleanup (hygiene only): node "${toPosix(sessionRepo)}/scripts/launch-workflow.mjs" cleanup --session-repo "${toPosix(sessionRepo)}" --run-id ${runId}`,
  ];

  emit({
    ok: true,
    phase: "prepare",
    run_id: runId,
    session_id: sessionId,
    scratch_cwd: toPosix(scratchCwd),
    os_temp_root: toPosix(osTempRoot),
    evidence_paths: evidencePaths,
    workflow_args: workflowArgs,
    pre_scan: preScan,
    launch_instruction: launchInstruction,
    prevention_claim: PREVENTION_CLAIM,
  });
}

// --- post-scan -----------------------------------------------------------------

function runPostScan(args) {
  const { evidence } = loadEvidence(args, "post-scan");
  const postScan = {
    scanned_at_iso: new Date().toISOString(),
    session_repo: scanTempArtifacts(evidence.session_repo.root),
    target_repo: scanTempArtifacts(evidence.target_repo.root),
    launch_cwd: scanTempArtifacts(evidence.launch_cwd),
  };
  evidence.post_scan = postScan;
  const evidencePaths = writeEvidence(evidence);
  const clean = [postScan.session_repo, postScan.target_repo, postScan.launch_cwd].every(
    (findings) => Array.isArray(findings) && findings.length === 0,
  );
  emit({
    ok: true,
    phase: "post-scan",
    run_id: evidence.run_id,
    clean,
    post_scan: postScan,
    evidence_paths: evidencePaths,
    prevention_claim: PREVENTION_CLAIM,
  });
}

// --- cleanup -----------------------------------------------------------------

function runCleanup(args) {
  const { evidence, runId } = loadEvidence(args, "cleanup");
  const scratch = evidence.launch_cwd;

  // Ownership is verified BEFORE any delete. The launcher clears ONLY its own
  // per-run scratch dir: Forge namespace, strictly under the recorded OS temp
  // root, outside both repos, and carrying this run's ownership marker.
  const namespaceOk = SCRATCH_NAMESPACE_RE.test(path.basename(scratch));
  const strictlyUnderTemp =
    isContainedIn(scratch, evidence.os_temp_root) &&
    normForCompare(scratch) !== normForCompare(evidence.os_temp_root);
  const insideARepo =
    isContainedIn(scratch, evidence.session_repo.root) ||
    isContainedIn(scratch, evidence.target_repo.root);
  if (!namespaceOk || !strictlyUnderTemp || insideARepo) {
    fail(
      "CLEANUP_REFUSED_NOT_FORGE_OWNED",
      `refusing to remove ${toPosix(scratch)}: it is not a Forge-owned per-run scratch dir ` +
        `(namespace=${String(namespaceOk)}, strictly-under-os-temp=${String(strictlyUnderTemp)}, inside-a-repo=${String(insideARepo)}). Nothing was deleted.`,
    );
  }

  let removed = false;
  if (fs.existsSync(scratch)) {
    const marker = path.join(scratch, "forge-launch-evidence.json");
    let markerRunId = null;
    try {
      markerRunId = JSON.parse(fs.readFileSync(marker, "utf8")).run_id;
    } catch {
      markerRunId = null;
    }
    if (markerRunId !== runId) {
      fail(
        "CLEANUP_REFUSED_NOT_FORGE_OWNED",
        `refusing to remove ${toPosix(scratch)}: its ownership marker (forge-launch-evidence.json) is missing or names a different run. Nothing was deleted.`,
      );
    }
    fs.rmSync(scratch, { recursive: true, force: true });
    removed = true;
  }

  const note =
    "cleanup is hygiene only; the prevention mechanism is launch-cwd placement (the session was " +
    "started FROM the Forge-owned OS-temp scratch cwd), not this removal";
  evidence.cleanup = {
    removed_scratch_cwd: removed ? toPosix(scratch) : null,
    already_clean: !removed,
    cleaned_at_iso: new Date().toISOString(),
    note,
  };
  const evidencePaths = writeEvidence(evidence);

  emit({
    ok: true,
    phase: "cleanup",
    run_id: evidence.run_id,
    removed_scratch_cwd: evidence.cleanup.removed_scratch_cwd,
    already_clean: evidence.cleanup.already_clean,
    evidence_paths: evidencePaths,
    note,
    prevention_claim: PREVENTION_CLAIM,
  });
}

// --- main ----------------------------------------------------------------------

const [, , phaseName, ...rest] = process.argv;
if (phaseName === "prepare") runPrepare(rest);
else if (phaseName === "post-scan") runPostScan(rest);
else if (phaseName === "cleanup") runCleanup(rest);
else usage(`unknown phase: ${String(phaseName)}`);
