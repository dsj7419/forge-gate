import { execFileSync } from "node:child_process";
import * as path from "node:path";

/**
 * Parse `git status --porcelain -z` output into the set of repo-relative posix
 * paths git considers changed — added, modified, deleted, untracked, and *both*
 * sides of a rename/copy. Pure: takes the raw stdout, returns paths.
 *
 * The `-z` form is used deliberately: records are NUL-terminated and paths are
 * emitted verbatim (no `core.quotePath` quoting), so a path containing a space or
 * other special character is matched correctly rather than slipping the fence.
 * A rename/copy is two NUL records — the new path carrying the `XY ` status prefix,
 * then the bare original path with no prefix.
 */
export function parsePorcelain(output: string): string[] {
  const records = output.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record === undefined || record === "") continue;
    const renamed = record.startsWith("R") || record.startsWith("C");
    const changedPath = record.slice(3); // strip the two-char XY status + its separating space
    if (changedPath !== "") paths.push(changedPath);
    if (renamed) {
      const original = records[i + 1];
      if (original !== undefined && original !== "") paths.push(original);
      i += 1; // the original path is its own bare NUL record — consume it
    }
  }
  return [...new Set(paths)];
}

/** Absolute worktree root of the repo containing `cwd`, or null if `cwd` is not in a git repo. */
export function resolveRepoRoot(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
    return path.resolve(out.trim());
  } catch {
    return null;
  }
}

/**
 * Read the worktree's changed files via `git status --porcelain -z`. Throws if git fails.
 *
 * `--untracked-files=all` is required: without it git collapses a wholly-untracked
 * directory to the bare directory path (`src/slug/`), which no file-level fence can
 * match — a false PATH_OUTSIDE_ALLOWED that also hides any forbidden file buried in
 * the new directory. With it, every new file is listed individually and fenced.
 */
export function readChangedFiles(repoRoot: string): string[] {
  const out = execFileSync("git", ["-C", repoRoot, "status", "--porcelain", "-z", "--untracked-files=all"], {
    encoding: "utf8",
  });
  return parsePorcelain(out);
}
