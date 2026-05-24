// Deterministic resolver for the Forge CLI, used by the Claude Code command
// wrappers so they invoke a single `node ...` command (clean tool-allowlist
// match) instead of a compound shell snippet.
//
// Resolution order (matches the documented wrapper contract):
//   1. $FORGE_BIN            (explicit override; pins a specific build)
//   2. `forge` on PATH       (e.g. after `pnpm link --global`)
//   3. local-dev fallback    (`pnpm -C <this-repo> forge ...`)
//
// All argv after the script are forwarded verbatim to the Forge CLI. stdio is
// inherited and the resolver exits with the CLI's exit code.

import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const onWindows = process.platform === "win32";

function onPath(bin) {
  const finder = onWindows ? "where" : "which";
  return spawnSync(finder, [bin], { stdio: "ignore" }).status === 0;
}

function run(command, commandArgs) {
  return spawnSync(command, commandArgs, { stdio: "inherit", shell: onWindows }).status ?? 1;
}

let exitCode;
if (process.env.FORGE_BIN) {
  exitCode = run(process.env.FORGE_BIN, args);
} else if (onPath("forge")) {
  exitCode = run("forge", args);
} else {
  // `-s` (silent) suppresses pnpm's lifecycle preamble so JSON subcommands emit clean stdout.
  exitCode = run("pnpm", ["-s", "-C", repoRoot, "forge", ...args]);
}

process.exit(exitCode);
