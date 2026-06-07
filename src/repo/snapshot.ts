import { execFileSync } from "node:child_process";

import type { CliIo } from "../cli/run.js";
import { parsePorcelain } from "../guard/git.js";

/**
 * CLI-facing adapter for a Core-owned, read-only repo-facts snapshot
 * (`forge repo snapshot`). It exists to give the workflow runner every
 * read-only git fact it needs WITHOUT shelling `git`/`git -C` through a Bash
 * tool call — every git invocation here is an internal `execFileSync("git", …)`
 * node child-process spawn (exactly as `src/guard/git.ts` already does), which
 * the PreToolUse Bash permissions hook never intercepts.
 *
 *   forge repo snapshot --repo-root <path> [--base <sha>]
 *
 * Output is a single JSON object on stdout:
 *
 *   {
 *     "repo_root": "<absolute path as given>",
 *     "clean": true,
 *     "changed_files": [],
 *     "head": "<full sha>",
 *     "branch": "<current branch name>",
 *     "ahead_of_base": null
 *   }
 *
 * - `clean` is `changed_files.length === 0`, computed from
 *   `status --porcelain -z --untracked-files=all` and parsed via the guard's
 *   `parsePorcelain` (imported, never re-implemented) so spaces / renames /
 *   untracked directories are handled identically to the path guard.
 * - `ahead_of_base` is the integer `rev-list --count <base>..HEAD` ONLY when
 *   `--base` is supplied; when `--base` is absent it is `null` (omitted, never
 *   fabricated as 0).
 *
 * All git access goes through the injected `RepoGit` seam; production binds the
 * real `defaultRepoGit`. Tests drive `runRepo` through an in-memory reader for
 * every fact, plus one real-fs temp-git test that proves `defaultRepoGit`.
 *
 * Exit codes: 0 success, 1 a typed failure (e.g. not a git repo), 2 usage error.
 */

/**
 * Injected git-reader seam. Every method is read-only. `revListCount` is only
 * called when a `--base` is supplied. A method throws on a git failure (e.g. the
 * path is not a git repo); the adapter maps a throw to a typed exit-1 failure.
 */
export type RepoGit = {
  /** Full HEAD sha (`rev-parse HEAD`). */
  head: (repoRoot: string) => string;
  /** Current branch name (`rev-parse --abbrev-ref HEAD`). */
  branch: (repoRoot: string) => string;
  /** Raw `status --porcelain -z --untracked-files=all` stdout (NUL-delimited). */
  statusPorcelain: (repoRoot: string) => string;
  /** Integer `rev-list --count <base>..HEAD`. */
  revListCount: (repoRoot: string, base: string) => number;
};

/**
 * Real-fs `RepoGit` binding. Every call is an internal `execFileSync("git", …)`
 * child-process spawn — NOT a Bash tool call — so the permissions hook does not
 * intercept it (the same mechanism `src/guard/git.ts` relies on). This is the
 * only place real git is touched.
 */
export const defaultRepoGit: RepoGit = {
  head: (repoRoot) =>
    execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  branch: (repoRoot) =>
    execFileSync("git", ["-C", repoRoot, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
    }).trim(),
  statusPorcelain: (repoRoot) =>
    execFileSync("git", ["-C", repoRoot, "status", "--porcelain", "-z", "--untracked-files=all"], {
      encoding: "utf8",
    }),
  revListCount: (repoRoot, base) => {
    const out = execFileSync("git", ["-C", repoRoot, "rev-list", "--count", `${base}..HEAD`], {
      encoding: "utf8",
    }).trim();
    return Number.parseInt(out, 10);
  },
};

export type RepoSnapshot = {
  repo_root: string;
  clean: boolean;
  changed_files: string[];
  head: string;
  branch: string;
  ahead_of_base: number | null;
};

/**
 * Pure snapshot computation over the injected reader. `base` undefined → no
 * `rev-list` call and `ahead_of_base: null`. Throws (propagated from the reader)
 * when git fails; `runRepo` maps that throw to a typed exit-1 failure.
 */
export function computeSnapshot(git: RepoGit, repoRoot: string, base?: string): RepoSnapshot {
  const changedFiles = parsePorcelain(git.statusPorcelain(repoRoot));
  return {
    repo_root: repoRoot,
    clean: changedFiles.length === 0,
    changed_files: changedFiles,
    head: git.head(repoRoot),
    branch: git.branch(repoRoot),
    ahead_of_base: base === undefined ? null : git.revListCount(repoRoot, base),
  };
}

const USAGE = "usage: forge repo snapshot --repo-root <path> [--base <sha>]";

const SNAPSHOT_FLAGS = new Set(["--repo-root", "--base"]);

export function runRepo(args: string[], cli: CliIo, git: RepoGit): number {
  const subcommand = args[0];
  if (subcommand === "snapshot") return runSnapshot(args.slice(1), cli, git);
  return usage(cli, `unknown subcommand: ${String(subcommand)}`);
}

function runSnapshot(rest: string[], cli: CliIo, git: RepoGit): number {
  const unknown = rest.filter((arg) => arg.startsWith("--") && !SNAPSHOT_FLAGS.has(arg));
  if (unknown.length > 0) return usage(cli, `unknown option(s): ${unknown.join(", ")}`);

  const repoRoot = flagValue(rest, "--repo-root");
  if (repoRoot === undefined) return usage(cli, "repo snapshot requires --repo-root <path>");

  // `--base` is optional. If the flag is present it must carry a value.
  const base = flagValue(rest, "--base");
  if (base === undefined && rest.includes("--base")) {
    return usage(cli, "--base requires a value");
  }

  let snapshot: RepoSnapshot;
  try {
    snapshot = computeSnapshot(git, repoRoot, base);
  } catch (thrown) {
    const error = thrown instanceof Error ? thrown.message : String(thrown);
    cli.print(JSON.stringify({ ok: false, code: "REPO_SNAPSHOT_FAILED", error }, null, 2));
    return 1;
  }
  cli.print(JSON.stringify(snapshot, null, 2));
  return 0;
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

function usage(cli: CliIo, detail: string): number {
  cli.printError(detail);
  cli.printError(USAGE);
  return 2;
}
