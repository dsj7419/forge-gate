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

console.log(`\nInstalled ${commands} command wrapper(s) and ${agents} agent charter(s) under ${claudeDir}`);
console.log("Ensure the `forge` CLI is on PATH (e.g. `pnpm -C <forge-repo> link --global` after `pnpm build`),");
console.log("or set FORGE_BIN, so the wrappers can find it.");
console.log("Note: agent charters are definitions only — nothing dispatches them until the orchestrator exists.");
