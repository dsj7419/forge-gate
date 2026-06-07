import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, onTestFinished, test } from "vitest";

import type { CliIo } from "../cli/run.js";
import { computeSnapshot, defaultRepoGit, runRepo, type RepoGit } from "./snapshot.js";

function fakeIo(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      print: (text) => out.push(text),
      printError: (text) => err.push(text),
      writeArtifact: () => {
        throw new Error("repo snapshot must never use the validation-artifact seam");
      },
    },
    out,
    err,
  };
}

/**
 * In-memory `RepoGit`. Each fact is a fixed value; `statusPorcelain` returns raw
 * `-z` (NUL-delimited) output so the adapter exercises the real `parsePorcelain`.
 * A method may be set to throw to simulate "not a git repo".
 */
function memoryRepoGit(overrides: Partial<RepoGit> = {}): {
  git: RepoGit;
  calls: { revListCount: { repoRoot: string; base: string }[] };
} {
  const calls = { revListCount: [] as { repoRoot: string; base: string }[] };
  const git: RepoGit = {
    head: () => "abc1234deadbeef",
    branch: () => "forge/epic/T01",
    statusPorcelain: () => "",
    revListCount: (repoRoot, base) => {
      calls.revListCount.push({ repoRoot, base });
      return 3;
    },
    ...overrides,
  };
  return { git, calls };
}

describe("computeSnapshot (injected reader)", () => {
  test("returns the current HEAD sha (AC1)", () => {
    const { git } = memoryRepoGit({ head: () => "feedface00112233" });
    expect(computeSnapshot(git, "/repo").head).toBe("feedface00112233");
  });

  test("returns the current branch name (AC2)", () => {
    const { git } = memoryRepoGit({ branch: () => "main" });
    expect(computeSnapshot(git, "/repo").branch).toBe("main");
  });

  test("reports clean=true on a clean tree (AC3)", () => {
    const { git } = memoryRepoGit({ statusPorcelain: () => "" });
    const snap = computeSnapshot(git, "/repo");
    expect(snap.clean).toBe(true);
    expect(snap.changed_files).toEqual([]);
  });

  test("reports clean=false when changes exist (AC3)", () => {
    const { git } = memoryRepoGit({ statusPorcelain: () => " M src/a.ts\0" });
    expect(computeSnapshot(git, "/repo").clean).toBe(false);
  });

  test("returns changed_files parsed like the guard, incl. untracked + rename (AC4)", () => {
    const { git } = memoryRepoGit({
      statusPorcelain: () => " M src/a.ts\0?? src/new.ts\0R  src/dst.ts\0src/src.ts\0",
    });
    expect(computeSnapshot(git, "/repo").changed_files).toEqual([
      "src/a.ts",
      "src/new.ts",
      "src/dst.ts",
      "src/src.ts",
    ]);
  });

  test("ahead_of_base is the integer base..HEAD count when --base is given (AC5)", () => {
    const { git } = memoryRepoGit({ revListCount: () => 7 });
    expect(computeSnapshot(git, "/repo", "base-sha").ahead_of_base).toBe(7);
  });

  test("ahead_of_base is null and rev-list is NOT called when --base is absent (AC5)", () => {
    const { git, calls } = memoryRepoGit();
    const snap = computeSnapshot(git, "/repo");
    expect(snap.ahead_of_base).toBeNull();
    expect(calls.revListCount).toEqual([]);
  });

  test("echoes the repo_root as given", () => {
    const { git } = memoryRepoGit();
    expect(computeSnapshot(git, "/some/repo/root").repo_root).toBe("/some/repo/root");
  });
});

describe("runRepo snapshot routing", () => {
  test("emits the snapshot JSON and exits 0 (no --base → ahead_of_base null)", () => {
    const { git, calls } = memoryRepoGit({
      head: () => "h1",
      branch: () => "b1",
      statusPorcelain: () => "",
    });
    const { io, out } = fakeIo();
    const code = runRepo(["snapshot", "--repo-root", "/repo"], io, git);
    expect(code).toBe(0);
    expect(JSON.parse(out.join("\n"))).toEqual({
      repo_root: "/repo",
      clean: true,
      changed_files: [],
      head: "h1",
      branch: "b1",
      ahead_of_base: null,
    });
    expect(calls.revListCount).toEqual([]);
  });

  test("passes --base through to rev-list and surfaces the count (exit 0)", () => {
    const calls: { repoRoot: string; base: string }[] = [];
    const { git } = memoryRepoGit({
      revListCount: (repoRoot, base) => {
        calls.push({ repoRoot, base });
        return 4;
      },
    });
    const { io, out } = fakeIo();
    const code = runRepo(["snapshot", "--repo-root", "/repo", "--base", "BASE"], io, git);
    expect(code).toBe(0);
    expect(JSON.parse(out.join("\n")).ahead_of_base).toBe(4);
    expect(calls).toEqual([{ repoRoot: "/repo", base: "BASE" }]);
  });

  test("a git failure (not a repo) is a typed exit-1 failure, never a throw", () => {
    const { git } = memoryRepoGit({
      head: () => {
        throw new Error("fatal: not a git repository");
      },
    });
    const { io, out } = fakeIo();
    const code = runRepo(["snapshot", "--repo-root", "/not-a-repo"], io, git);
    expect(code).toBe(1);
    const json = JSON.parse(out.join("\n"));
    expect(json.ok).toBe(false);
    expect(json.code).toBe("REPO_SNAPSHOT_FAILED");
  });

  test("missing --repo-root is a usage error (exit 2)", () => {
    const { git } = memoryRepoGit();
    const { io, err } = fakeIo();
    expect(runRepo(["snapshot"], io, git)).toBe(2);
    expect(err.join("\n")).toMatch(/usage/i);
  });

  test("--base without a value is a usage error (exit 2)", () => {
    const { git } = memoryRepoGit();
    const { io, err } = fakeIo();
    expect(runRepo(["snapshot", "--repo-root", "/repo", "--base"], io, git)).toBe(2);
    expect(err.join("\n")).toMatch(/usage/i);
  });

  test("an unknown option is a usage error (exit 2)", () => {
    const { git } = memoryRepoGit();
    const { io, err } = fakeIo();
    expect(runRepo(["snapshot", "--repo-root", "/repo", "--bogus"], io, git)).toBe(2);
    expect(err.join("\n")).toMatch(/usage/i);
  });

  test("an unknown subcommand is a usage error (exit 2)", () => {
    const { git } = memoryRepoGit();
    const { io, err } = fakeIo();
    expect(runRepo(["frobnicate"], io, git)).toBe(2);
    expect(err.join("\n")).toMatch(/usage/i);
  });
});

// Real-fs proof that `defaultRepoGit` works against an actual throwaway repo.
// Mirrors src/guard/git.test.ts's real-worktree test: deterministic, cleaned up,
// no destructive op. This is the only test that runs real git.
describe("defaultRepoGit (real git worktree)", () => {
  function gitIn(repo: string, ...args: string[]): void {
    execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  }

  function freshRepo(): string {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "forge-repo-snapshot-")));
    onTestFinished(() => fs.rmSync(repo, { recursive: true, force: true }));
    gitIn(repo, "init", "-q");
    gitIn(repo, "config", "user.email", "test@forge.invalid");
    gitIn(repo, "config", "user.name", "Forge Test");
    gitIn(repo, "config", "commit.gpgsign", "false");
    gitIn(repo, "checkout", "-q", "-b", "main");
    return repo;
  }

  function writeFile(repo: string, rel: string, body: string): void {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }

  test("computes head, branch, clean/dirty, changed_files, and ahead_of_base end to end", () => {
    const repo = freshRepo();
    writeFile(repo, "a.ts", "export const a = 1;\n");
    gitIn(repo, "add", "a.ts");
    gitIn(repo, "commit", "-q", "-m", "baseline");

    const base = defaultRepoGit.head(repo);

    // Clean tree right after the baseline commit.
    const clean = computeSnapshot(defaultRepoGit, repo, base);
    expect(clean.head).toMatch(/^[0-9a-f]{40}$/);
    expect(clean.branch).toBe("main");
    expect(clean.clean).toBe(true);
    expect(clean.changed_files).toEqual([]);
    expect(clean.ahead_of_base).toBe(0);

    // Add a second commit so HEAD is one ahead of `base`, plus an untracked file.
    writeFile(repo, "b.ts", "export const b = 2;\n");
    gitIn(repo, "add", "b.ts");
    gitIn(repo, "commit", "-q", "-m", "second");
    writeFile(repo, "untracked.ts", "export const c = 3;\n");

    const dirty = computeSnapshot(defaultRepoGit, repo, base);
    expect(dirty.clean).toBe(false);
    expect(dirty.changed_files).toEqual(["untracked.ts"]);
    expect(dirty.head).not.toBe(base);
    expect(dirty.ahead_of_base).toBe(1);

    // Without --base, ahead_of_base is null and no rev-list runs.
    const noBase = computeSnapshot(defaultRepoGit, repo);
    expect(noBase.ahead_of_base).toBeNull();
  });
});
