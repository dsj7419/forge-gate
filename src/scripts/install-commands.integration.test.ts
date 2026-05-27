import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

// Integration test: drives the actual install script (scripts/install-commands.mjs) as a subprocess
// with USERPROFILE/HOME redirected to a fresh temp directory, so `os.homedir()` resolves there and
// the real ~/.claude is never touched. We do not import the .mjs (keeps strict typecheck clean).
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(repoRoot, "scripts", "install-commands.mjs");
const sourceCommandsDir = path.join(repoRoot, "commands");
const sourceAgentsDir = path.join(repoRoot, "agents");

function mdFileNames(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

describe("install-commands post-install summary", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "forge-install-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  test("copies command and agent .md files into <temp>/.claude and guides toward verify-install", () => {
    const result = spawnSync("node", [script], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
      env: { ...process.env, USERPROFILE: tempHome, HOME: tempHome },
    });

    expect(result.status).toBe(0);

    const stdout = result.stdout;

    // (a) verify-install guidance appears, with node dist/cli.js as the primary next step.
    expect(stdout).toContain("node dist/cli.js verify-install");
    expect(stdout).toContain("exit 0 = current; 1 = stale/missing");
    // Re-run path for stale/missing files.
    expect(stdout).toContain("pnpm install-commands");
    // forge verify-install mentioned only as a PATH option.
    expect(stdout).toContain("forge verify-install");
    expect(stdout).toContain("on PATH");
    // No hooks/automation implied.
    expect(stdout.toLowerCase()).not.toContain("hook");
    expect(stdout.toLowerCase()).not.toContain("automatically");

    // (b) command *.md files are copied to <temp>/.claude/commands
    const installedCommandsDir = path.join(tempHome, ".claude", "commands");
    expect(mdFileNames(installedCommandsDir)).toEqual(mdFileNames(sourceCommandsDir));

    // (c) agent *.md files are copied to <temp>/.claude/agents
    const installedAgentsDir = path.join(tempHome, ".claude", "agents");
    expect(mdFileNames(installedAgentsDir)).toEqual(mdFileNames(sourceAgentsDir));

    // Summary states the Claude config home path and the counts.
    expect(stdout).toContain(path.join(tempHome, ".claude"));

    // (d) only the temp home is used — the real ~/.claude is never the target here.
    const realClaudeDir = path.join(os.homedir(), ".claude");
    expect(stdout).not.toContain(realClaudeDir);
  });
});
