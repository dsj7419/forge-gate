// Installs the Forge Claude Code integration into the user's global config:
//   commands/*.md -> ~/.claude/commands/   (thin slash-command wrappers)
//   agents/*.md   -> ~/.claude/agents/     (subagent charters)
// These are thin/declarative; the Forge CLI core remains the source of truth.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const claudeDir = path.join(os.homedir(), ".claude");

function installDir(sourceName, targetName) {
  const sourceDir = path.join(here, "..", sourceName);
  const targetDir = path.join(claudeDir, targetName);
  fs.mkdirSync(targetDir, { recursive: true });

  let installed = 0;
  for (const name of fs.readdirSync(sourceDir).sort()) {
    if (!name.endsWith(".md")) continue;
    fs.copyFileSync(path.join(sourceDir, name), path.join(targetDir, name));
    console.log(`installed ${targetName}/${name}`);
    installed += 1;
  }
  return installed;
}

const commands = installDir("commands", "commands");
const agents = installDir("agents", "agents");

console.log(`\nInstalled ForgeGate Claude integration under ${claudeDir}:`);
console.log(`  commands: ${commands}`);
console.log(`  agents:   ${agents}`);
console.log("");
console.log("Next — confirm the installed files match this checkout:");
console.log("  node dist/cli.js verify-install        (exit 0 = current; 1 = stale/missing)");
console.log("");
console.log("If it reports stale or missing files, re-run:");
console.log("  pnpm install-commands");
console.log("  node dist/cli.js verify-install");
console.log("");
console.log("If the `forge` CLI is on PATH, you may also run:");
console.log("  forge verify-install");
console.log("");
console.log("Agent charters are dispatched live by the `/forge-run-ticket` orchestrator.");
