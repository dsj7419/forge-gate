import * as fs from "node:fs";
import * as path from "node:path";

import type { CliIo } from "../cli/run.js";
import { fenceOf, loadActiveTicket, type ReadFile } from "./active-ticket.js";
import { readChangedFiles, resolveRepoRoot } from "./git.js";
import { evaluateFence, repoRootsMatch, type GuardResult } from "./path-guard.js";

const DEFAULT_ACTIVE_PATH = ".forge/active-ticket.json";
const NOT_A_GIT_REPO = "(not a git repository)";
const GUARD_FLAGS = new Set(["--active", "--json"]);
const GUARD_USAGE = "usage: forge guard paths [--active <active-ticket.json>] [--json]";

/** Side-effectful boundary so the guard command is fully testable without git or disk. */
export type GuardEnv = {
  resolveRepoRoot: (cwd: string) => string | null;
  readChangedFiles: (repoRoot: string) => string[];
  readActiveTicket: ReadFile;
};

export const defaultGuardEnv: GuardEnv = {
  resolveRepoRoot,
  readChangedFiles,
  readActiveTicket: (activePath) => fs.readFileSync(activePath, "utf8"),
};

/**
 * `forge guard paths` — check the current worktree against the active ticket's
 * path fence. Reads a gitignored active-ticket file and the live `git status`;
 * writes nothing. Exit 0 when clean, 1 on any violation or load failure, 2 on a
 * usage error. Designed to be callable from a future pre-commit/pre-push hook.
 *
 * On a repo_root mismatch (or no git repo) we never read `git status`: evidence
 * gathered in the wrong repository is invalid evidence.
 */
export function runGuardPaths(args: string[], io: CliIo, env: GuardEnv = defaultGuardEnv): number {
  const [subcommand, ...flags] = args;
  if (subcommand !== "paths") return usage(io, "guard requires the `paths` subcommand");

  const unknown = flags.filter((flag) => flag.startsWith("--") && !GUARD_FLAGS.has(flag));
  if (unknown.length > 0) return usage(io, `unknown option(s): ${unknown.join(", ")}`);

  const asJson = flags.includes("--json");
  const activePath = path.resolve(flagValue(flags, "--active") ?? DEFAULT_ACTIVE_PATH);

  const loaded = loadActiveTicket(activePath, env.readActiveTicket);
  if (!loaded.ok) {
    return report(io, asJson, { ok: false, findings: [{ code: loaded.code, message: loaded.message }] });
  }

  const fence = fenceOf(loaded.ticket);
  const observedRoot = env.resolveRepoRoot(process.cwd());
  const inRightRepo = observedRoot !== null && repoRootsMatch(observedRoot, fence.repo_root);
  const changedFiles = inRightRepo ? env.readChangedFiles(observedRoot) : [];
  const result = evaluateFence({ fence, changedFiles, observedRepoRoot: observedRoot ?? NOT_A_GIT_REPO });

  return report(io, asJson, result);
}

function report(io: CliIo, asJson: boolean, result: GuardResult): number {
  if (asJson) {
    io.print(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }
  if (result.ok) {
    io.print("guard: OK — all changed files are within the active ticket's fence");
    return 0;
  }
  io.print(`guard: ${result.findings.length} fence violation(s)`);
  for (const finding of result.findings) {
    const where = finding.path !== undefined ? `${finding.path} — ` : "";
    io.print(`  [${finding.code}] ${where}${finding.message}`);
  }
  return 1;
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value !== undefined && !value.startsWith("--") ? value : undefined;
}

function usage(io: CliIo, detail: string): number {
  io.printError(detail);
  io.printError(GUARD_USAGE);
  return 2;
}
