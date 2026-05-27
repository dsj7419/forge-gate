import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { CliIo } from "../cli/run.js";
import {
  compareInstall,
  type InstallEntry,
  type InstallReader,
  type InstallReport,
} from "./verify-install.js";

const VERIFY_INSTALL_USAGE = "usage: forge verify-install";

/**
 * Side-effectful boundary for `forge verify-install`. The checkout directory,
 * the Claude config home, and the file reader are all injectable so tests run
 * against temp fixtures and never touch the real `~/.claude`.
 */
export type VerifyInstallEnv = {
  /** The ForgeGate checkout root (contains `commands/` and `agents/`). */
  checkoutDir: string;
  /** The user's Claude config home (`~/.claude`). */
  claudeHome: string;
  reader: InstallReader;
};

/** The real checkout root is the repo root, two levels up from `dist/install/`. */
function defaultCheckoutDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

const defaultReader: InstallReader = {
  listMarkdown: (dir) => {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    return names.filter((name) => name.endsWith(".md")).sort();
  },
  readFile: (dir, name) => fs.readFileSync(path.join(dir, name), "utf8"),
};

export const defaultVerifyInstallEnv: VerifyInstallEnv = {
  checkoutDir: defaultCheckoutDir(),
  claudeHome: path.join(os.homedir(), ".claude"),
  reader: defaultReader,
};

/**
 * `forge verify-install` — report whether the installed Claude commands and
 * agent charters are current with this ForgeGate checkout. Read-only: it
 * compares the checkout's `commands/`-`agents/` `*.md` files against the copies
 * under the Claude config home and writes nothing. Exit 0 when every required
 * file is current (informational `extra` files do not count), 1 when any is
 * `missing` or `stale`, 2 on a usage error.
 */
export function runVerifyInstall(args: string[], io: CliIo, env: VerifyInstallEnv = defaultVerifyInstallEnv): number {
  const unknown = args.filter((arg) => arg.startsWith("--"));
  if (unknown.length > 0) return usage(io, `unknown option(s): ${unknown.join(", ")}`);
  if (args.length > 0) return usage(io, `unexpected argument(s): ${args.join(", ")}`);

  const report = compareInstall({
    commandsCheckoutDir: path.join(env.checkoutDir, "commands"),
    agentsCheckoutDir: path.join(env.checkoutDir, "agents"),
    commandsInstalledDir: path.join(env.claudeHome, "commands"),
    agentsInstalledDir: path.join(env.claudeHome, "agents"),
    reader: env.reader,
  });

  io.print(formatReport(report, env.claudeHome));
  return report.ok ? 0 : 1;
}

function formatReport(report: InstallReport, claudeHome: string): string {
  const lines = [`Forge verify-install: ${claudeHome}`];

  const required = report.entries.filter((entry) => entry.status !== "extra");
  const extra = report.entries.filter((entry) => entry.status === "extra");
  const outdated = required.filter((entry) => entry.status !== "current");

  lines.push(`Result: ${report.ok ? "OK — all required files current" : "OUT OF DATE"}`);
  lines.push(`Required files (${required.length}):`);
  lines.push(...required.map(formatEntry));

  if (extra.length > 0) {
    lines.push(`Extra installed files (${extra.length}, informational):`);
    lines.push(...extra.map(formatEntry));
  }

  if (outdated.length > 0) {
    lines.push(
      `${outdated.length} file(s) need (re)installing — run \`pnpm install-commands\` in the ForgeGate checkout.`,
    );
  }

  return lines.join("\n");
}

function formatEntry(entry: InstallEntry): string {
  return `  [${entry.status}] ${entry.kind}: ${entry.name}`;
}

function usage(io: CliIo, detail: string): number {
  io.printError(detail);
  io.printError(VERIFY_INSTALL_USAGE);
  return 2;
}
