// Installs the Forge Claude Code command wrappers into the user's global
// command directory (~/.claude/commands). The wrappers are thin shells over the
// Forge CLI; the Forge core remains the source of truth.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.join(here, "..", "commands");
const targetDir = path.join(os.homedir(), ".claude", "commands");

fs.mkdirSync(targetDir, { recursive: true });

let installed = 0;
for (const name of fs.readdirSync(commandsDir).sort()) {
  if (!name.endsWith(".md")) continue;
  fs.copyFileSync(path.join(commandsDir, name), path.join(targetDir, name));
  console.log(`installed ${name}`);
  installed += 1;
}

console.log(`\nInstalled ${installed} Forge command wrapper(s) to ${targetDir}`);
console.log("Ensure the `forge` CLI is on PATH (e.g. `pnpm -C <forge-repo> link --global` after `pnpm build`),");
console.log("or set FORGE_BIN, so the wrappers can find it.");
