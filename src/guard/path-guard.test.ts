import { describe, expect, test } from "vitest";

import { evaluateFence, GuardCode, type GuardFence } from "./path-guard.js";

const fence: GuardFence = {
  repo_root: "/repo",
  allowed_paths: ["src/example/**"],
  forbidden_paths: ["package.json", "pnpm-lock.yaml"],
  protected_paths: ["**/manifest.yaml", "**/epic.yaml", "docs/governance/**"],
};

function codes(result: { findings: { code: string }[] }): string[] {
  return result.findings.map((finding) => finding.code);
}

describe("evaluateFence", () => {
  test("a change wholly inside allowed_paths passes clean", () => {
    const result = evaluateFence({ fence, changedFiles: ["src/example/a.ts", "src/example/nested/b.ts"] });

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  test("no changed files at all is clean", () => {
    const result = evaluateFence({ fence, changedFiles: [] });

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  test("a change outside allowed_paths is reported PATH_OUTSIDE_ALLOWED", () => {
    const result = evaluateFence({ fence, changedFiles: ["src/other/c.ts"] });

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({ code: GuardCode.PATH_OUTSIDE_ALLOWED, path: "src/other/c.ts" }),
    ]);
  });

  test("a change inside forbidden_paths is reported FORBIDDEN_PATH_TOUCHED", () => {
    const result = evaluateFence({ fence, changedFiles: ["package.json"] });

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({ code: GuardCode.FORBIDDEN_PATH_TOUCHED, path: "package.json" }),
    ]);
  });

  test("a change inside protected_paths is reported PROTECTED_PATH_TOUCHED", () => {
    const result = evaluateFence({ fence, changedFiles: ["docs/epics/x/manifest.yaml"] });

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({ code: GuardCode.PROTECTED_PATH_TOUCHED, path: "docs/epics/x/manifest.yaml" }),
    ]);
  });

  test("multiple violations across files are all reported together", () => {
    const result = evaluateFence({
      fence,
      changedFiles: ["src/example/ok.ts", "src/stray.ts", "pnpm-lock.yaml", "docs/governance/RULES.md"],
    });

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual([
      GuardCode.PATH_OUTSIDE_ALLOWED,
      GuardCode.FORBIDDEN_PATH_TOUCHED,
      GuardCode.PROTECTED_PATH_TOUCHED,
    ]);
  });

  test("forbidden takes precedence over a broad allow that would otherwise match", () => {
    const broad: GuardFence = { ...fence, allowed_paths: ["**"], forbidden_paths: ["src/secret.ts"] };

    const result = evaluateFence({ fence: broad, changedFiles: ["src/secret.ts"] });

    expect(codes(result)).toEqual([GuardCode.FORBIDDEN_PATH_TOUCHED]);
  });

  test("protected takes precedence over a broad allow that would otherwise match", () => {
    const broad: GuardFence = { ...fence, allowed_paths: ["**"] };

    const result = evaluateFence({ fence: broad, changedFiles: ["epic.yaml"] });

    expect(codes(result)).toEqual([GuardCode.PROTECTED_PATH_TOUCHED]);
  });

  test("a repeated changed path yields a single finding", () => {
    const result = evaluateFence({ fence, changedFiles: ["src/stray.ts", "src/stray.ts"] });

    expect(codes(result)).toEqual([GuardCode.PATH_OUTSIDE_ALLOWED]);
  });

  test("a forbidden path containing a space is still flagged (no quoting bypass)", () => {
    const spaced: GuardFence = { ...fence, forbidden_paths: ["src/secret file.ts"] };

    const result = evaluateFence({ fence: spaced, changedFiles: ["src/secret file.ts"] });

    expect(codes(result)).toEqual([GuardCode.FORBIDDEN_PATH_TOUCHED]);
  });

  test("**/manifest.yaml matches a top-level manifest as well as a nested one", () => {
    const result = evaluateFence({ fence, changedFiles: ["manifest.yaml"] });

    expect(codes(result)).toEqual([GuardCode.PROTECTED_PATH_TOUCHED]);
  });

  test("a worktree root that does not match the active ticket short-circuits to REPO_ROOT_MISMATCH", () => {
    const result = evaluateFence({
      fence,
      changedFiles: ["src/example/a.ts"],
      observedRepoRoot: "/somewhere/else",
    });

    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual([GuardCode.REPO_ROOT_MISMATCH]);
  });

  test("a matching worktree root still evaluates the fence normally", () => {
    const result = evaluateFence({
      fence,
      changedFiles: ["src/example/a.ts"],
      observedRepoRoot: "/repo",
    });

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });
});
