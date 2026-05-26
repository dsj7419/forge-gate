import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, onTestFinished, test } from "vitest";

import { parsePorcelain, readChangedFiles } from "./git.js";
import { evaluateFence, GuardCode, type GuardFence } from "./path-guard.js";

// `git status --porcelain -z`: NUL-terminated records with paths emitted verbatim
// (no core.quotePath quoting). A rename is two NUL records — the new path carrying
// the `XY ` prefix, then the bare original path.
describe("parsePorcelain (NUL-delimited -z form)", () => {
  test("extracts modified, added, and untracked paths", () => {
    const out = " M src/a.ts\0A  src/b.ts\0?? src/c.ts\0";

    expect(parsePorcelain(out)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  test("extracts a deleted path", () => {
    expect(parsePorcelain(" D src/gone.ts\0")).toEqual(["src/gone.ts"]);
  });

  test("extracts both sides of a rename (new then original, each its own NUL record)", () => {
    expect(parsePorcelain("R  src/new.ts\0src/old.ts\0")).toEqual(["src/new.ts", "src/old.ts"]);
  });

  test("preserves a path containing spaces verbatim — the quoting fence-bypass regression", () => {
    expect(parsePorcelain("?? src/secret file.ts\0")).toEqual(["src/secret file.ts"]);
  });

  test("preserves spaces on both sides of a renamed path", () => {
    expect(parsePorcelain("R  src/new name.ts\0src/old name.ts\0")).toEqual(["src/new name.ts", "src/old name.ts"]);
  });

  test("returns nothing for empty output", () => {
    expect(parsePorcelain("")).toEqual([]);
  });

  test("handles a mixed status with a rename, deduping repeats", () => {
    const out = " M README.md\0R  a.ts\0z.ts\0?? a.ts\0";

    expect(parsePorcelain(out)).toEqual(["README.md", "a.ts", "z.ts"]);
  });
});

// Integration coverage for `readChangedFiles`, which shells out to real git. The
// pure parser above cannot catch a wrong `git status` flag — only a real worktree
// can. Regression (found by the first external pilot): a brand-new untracked
// directory must be reported as its individual files. Without --untracked-files=all
// git collapses it to the bare directory path (`src/slug/`), which no file-level
// allowed_path can match — a false PATH_OUTSIDE_ALLOWED that also hides any
// forbidden file buried in the new directory.
describe("readChangedFiles (real git worktree)", () => {
  function gitIn(repo: string, ...args: string[]): void {
    execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  }

  function freshRepo(): string {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "forge-guard-git-")));
    onTestFinished(() => fs.rmSync(repo, { recursive: true, force: true }));
    gitIn(repo, "init", "-q");
    gitIn(repo, "config", "user.email", "test@forge.invalid");
    gitIn(repo, "config", "user.name", "Forge Test");
    gitIn(repo, "config", "commit.gpgsign", "false");
    return repo;
  }

  function writeFile(repo: string, rel: string, body: string): void {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }

  test("lists files in a brand-new untracked directory individually, not the collapsed dir", () => {
    const repo = freshRepo();
    writeFile(repo, "src/slug/slugifyTitle.ts", "export const x = 1;\n");
    writeFile(repo, "src/slug/slugifyTitle.test.ts", "// test\n");

    const changed = readChangedFiles(repo);

    expect([...changed].sort()).toEqual(["src/slug/slugifyTitle.test.ts", "src/slug/slugifyTitle.ts"]);
    expect(changed).not.toContain("src/slug/");
  });

  test("still reports a modified tracked file (--untracked-files=all must not regress tracked detection)", () => {
    const repo = freshRepo();
    writeFile(repo, "tracked.ts", "export const a = 1;\n");
    gitIn(repo, "add", "tracked.ts");
    gitIn(repo, "commit", "-q", "-m", "baseline");
    writeFile(repo, "tracked.ts", "export const a = 2;\n");

    expect(readChangedFiles(repo)).toEqual(["tracked.ts"]);
  });

  test("reproduces the pilot: a new dir whose files are all inside allowed_paths passes the fence", () => {
    const repo = freshRepo();
    writeFile(repo, "src/slug/slugifyTitle.ts", "export const x = 1;\n");
    writeFile(repo, "src/slug/slugifyTitle.test.ts", "// test\n");
    const fence: GuardFence = {
      repo_root: repo,
      allowed_paths: ["src/slug/slugifyTitle.ts", "src/slug/slugifyTitle.test.ts"],
      forbidden_paths: [],
      protected_paths: [],
    };

    const result = evaluateFence({ fence, changedFiles: readChangedFiles(repo) });

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  test("a new dir with a file outside allowed_paths fails on exactly that file", () => {
    const repo = freshRepo();
    writeFile(repo, "src/slug/slugifyTitle.ts", "export const x = 1;\n");
    writeFile(repo, "src/slug/stray.ts", "export const y = 2;\n");
    const fence: GuardFence = {
      repo_root: repo,
      allowed_paths: ["src/slug/slugifyTitle.ts"],
      forbidden_paths: [],
      protected_paths: [],
    };

    const result = evaluateFence({ fence, changedFiles: readChangedFiles(repo) });

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({ code: GuardCode.PATH_OUTSIDE_ALLOWED, path: "src/slug/stray.ts" }),
    ]);
  });

  test("a forbidden file buried in a brand-new directory is still caught", () => {
    const repo = freshRepo();
    writeFile(repo, "src/feature/index.ts", "export const ok = 1;\n");
    writeFile(repo, "src/feature/.env", "SECRET=1\n");
    const fence: GuardFence = {
      repo_root: repo,
      allowed_paths: ["src/feature/**"],
      forbidden_paths: ["**/.env"],
      protected_paths: [],
    };

    const result = evaluateFence({ fence, changedFiles: readChangedFiles(repo) });

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({ code: GuardCode.FORBIDDEN_PATH_TOUCHED, path: "src/feature/.env" }),
    ]);
  });
});
