import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

// Integration test: drives the actual resolver (scripts/run-forge-cli.mjs), which is how the Claude
// command wrappers invoke the CLI. Guards against pnpm's lifecycle preamble polluting JSON stdout.
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const resolver = path.join(repoRoot, "scripts", "run-forge-cli.mjs");
const sandboxEpic = path.join(repoRoot, "sandbox-epic");

describe("run-forge-cli resolver", () => {
  test("`packets` emits clean, parseable JSON with no pnpm preamble", () => {
    const result = spawnSync("node", [resolver, "packets", sandboxEpic], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("forge-core@"); // no `> forge-core@x.y.z forge` preamble
    const parsed = JSON.parse(result.stdout) as { engineer: { repo_root: string } };
    expect(path.isAbsolute(parsed.engineer.repo_root)).toBe(true);
  });
});
