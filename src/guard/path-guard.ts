import * as path from "node:path";

import picomatch from "picomatch";

/**
 * Canonical, stable finding codes for the path-fence guard. Centralized so they
 * never drift and cannot be mistyped — the pure evaluator, the active-ticket
 * loader, and the CLI wrapper all key off these.
 */
export const GuardCode = {
  ACTIVE_TICKET_MISSING: "ACTIVE_TICKET_MISSING",
  ACTIVE_TICKET_INVALID: "ACTIVE_TICKET_INVALID",
  PATH_OUTSIDE_ALLOWED: "PATH_OUTSIDE_ALLOWED",
  FORBIDDEN_PATH_TOUCHED: "FORBIDDEN_PATH_TOUCHED",
  PROTECTED_PATH_TOUCHED: "PROTECTED_PATH_TOUCHED",
  REPO_ROOT_MISMATCH: "REPO_ROOT_MISMATCH",
} as const;

export type GuardCodeValue = (typeof GuardCode)[keyof typeof GuardCode];

export type GuardFinding = {
  code: GuardCodeValue;
  message: string;
  /** Repo-relative posix path the finding points at; absent for whole-run findings. */
  path?: string;
};

export type GuardResult = {
  ok: boolean;
  findings: GuardFinding[];
};

/** The fence a change is measured against. Paths are globs; repo_root is absolute. */
export type GuardFence = {
  repo_root: string;
  allowed_paths: string[];
  forbidden_paths: string[];
  protected_paths: string[];
};

export type EvaluateFenceInput = {
  fence: GuardFence;
  /** Repo-relative posix paths of every file git reports as changed. */
  changedFiles: string[];
  /** The actual worktree root, when known — used to reject wrong-repo evidence. */
  observedRepoRoot?: string;
};

/**
 * Pure, deterministic path-fence evaluation. Given a fence and the set of changed
 * files, report every file that escapes `allowed_paths` or touches a
 * `forbidden`/`protected` path. Writes nothing and performs no IO.
 *
 * Precedence per file is forbidden → protected → outside-allowed, so an explicit
 * forbid/protect always wins over a broad allow that would otherwise cover it.
 *
 * If `observedRepoRoot` is supplied and differs from the fence's `repo_root`, the
 * evaluation short-circuits to a single REPO_ROOT_MISMATCH: evidence gathered in
 * the wrong repository is invalid evidence, so the per-file fence is not applied.
 */
export function evaluateFence(input: EvaluateFenceInput): GuardResult {
  const { fence, changedFiles, observedRepoRoot } = input;

  if (observedRepoRoot !== undefined && !repoRootsMatch(observedRepoRoot, fence.repo_root)) {
    return toResult([
      {
        code: GuardCode.REPO_ROOT_MISMATCH,
        message:
          `active-ticket repo_root "${fence.repo_root}" does not match the worktree root ` +
          `"${observedRepoRoot}"; refusing to evaluate the fence against the wrong repository`,
      },
    ]);
  }

  const findings: GuardFinding[] = [];
  for (const file of dedupe(changedFiles)) {
    const finding = classify(file, fence);
    if (finding !== undefined) findings.push(finding);
  }
  return toResult(findings);
}

function classify(file: string, fence: GuardFence): GuardFinding | undefined {
  const forbidden = matchedGlob(fence.forbidden_paths, file);
  if (forbidden !== undefined) {
    return { code: GuardCode.FORBIDDEN_PATH_TOUCHED, path: file, message: `changed file "${file}" matches forbidden path "${forbidden}"` };
  }
  const protectedGlob = matchedGlob(fence.protected_paths, file);
  if (protectedGlob !== undefined) {
    return { code: GuardCode.PROTECTED_PATH_TOUCHED, path: file, message: `changed file "${file}" matches protected path "${protectedGlob}"` };
  }
  if (matchedGlob(fence.allowed_paths, file) === undefined) {
    return { code: GuardCode.PATH_OUTSIDE_ALLOWED, path: file, message: `changed file "${file}" is outside allowed_paths` };
  }
  return undefined;
}

/** First glob in `globs` that matches `candidate`, or undefined. `dot:true` so dotfiles (e.g. .env) are caught by `**`. */
function matchedGlob(globs: string[], candidate: string): string | undefined {
  return globs.find((glob) => picomatch.isMatch(candidate, glob, { dot: true }));
}

/** True when two paths resolve to the same absolute location (separator/case-tolerant via path.relative). */
export function repoRootsMatch(a: string, b: string): boolean {
  return path.relative(path.resolve(a), path.resolve(b)) === "";
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function toResult(findings: GuardFinding[]): GuardResult {
  return { ok: findings.length === 0, findings };
}
