import * as path from "node:path";

import { describe, expect, test } from "vitest";

import type { CliIo } from "../cli/run.js";
import { runVerifyInstall, type VerifyInstallEnv } from "./cli.js";

const CHECKOUT = "/checkout";
const CLAUDE_HOME = "/home/.claude";
// Mirror the join the command performs, so the in-memory tree keys match on any OS.
const dir = {
  checkoutCommands: path.join(CHECKOUT, "commands"),
  checkoutAgents: path.join(CHECKOUT, "agents"),
  homeCommands: path.join(CLAUDE_HOME, "commands"),
  homeAgents: path.join(CLAUDE_HOME, "agents"),
} as const;

function fakeIo(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      print: (text) => out.push(text),
      printError: (text) => err.push(text),
      writeArtifact: () => {
        throw new Error("verify-install must never write an artifact");
      },
    },
    out,
    err,
  };
}

type Tree = Record<string, Record<string, string>>;

/** Models the four directories in memory and records every fs touch. */
function env(checkout: Tree, home: Tree): { env: VerifyInstallEnv; touched: string[] } {
  const touched: string[] = [];
  const merged: Tree = { ...checkout, ...home };
  return {
    touched,
    env: {
      checkoutDir: CHECKOUT,
      claudeHome: CLAUDE_HOME,
      reader: {
        listMarkdown: (d) => {
          touched.push(d);
          const entry = merged[d];
          return entry === undefined ? [] : Object.keys(entry).filter((n) => n.endsWith(".md")).sort();
        },
        readFile: (d, name) => {
          touched.push(path.join(d, name));
          const content = merged[d]?.[name];
          if (content === undefined) {
            const error = new Error("ENOENT") as NodeJS.ErrnoException;
            error.code = "ENOENT";
            throw error;
          }
          return content;
        },
      },
    },
  };
}

const checkoutCurrent: Tree = {
  [dir.checkoutCommands]: { "forge-validate.md": "A" },
  [dir.checkoutAgents]: { "forge-engineer.md": "C" },
};
const homeCurrent: Tree = {
  [dir.homeCommands]: { "forge-validate.md": "A" },
  [dir.homeAgents]: { "forge-engineer.md": "C" },
};

describe("runVerifyInstall", () => {
  test("exits 0 with a summary when every required file is current", () => {
    const e = env(checkoutCurrent, homeCurrent);
    const { io, out } = fakeIo();
    const code = runVerifyInstall([], io, e.env);

    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/current/i);
    expect(out.join("\n")).toMatch(/OK|up to date|current/i);
  });

  test("exits 1 and reports `missing` when a required command file is absent", () => {
    const e = env(checkoutCurrent, { [dir.homeCommands]: {}, [dir.homeAgents]: { "forge-engineer.md": "C" } });
    const { io, out } = fakeIo();
    const code = runVerifyInstall([], io, e.env);

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("missing");
    expect(out.join("\n")).toContain("forge-validate.md");
  });

  test("exits 1 and reports `stale` when a required agent file differs in content", () => {
    const e = env(checkoutCurrent, {
      [dir.homeCommands]: { "forge-validate.md": "A" },
      [dir.homeAgents]: { "forge-engineer.md": "DIFFERENT" },
    });
    const { io, out } = fakeIo();
    const code = runVerifyInstall([], io, e.env);

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("stale");
    expect(out.join("\n")).toContain("forge-engineer.md");
  });

  test("an informational `extra` file does not flip a clean exit 0", () => {
    const e = env(checkoutCurrent, {
      [dir.homeCommands]: { "forge-validate.md": "A", "forge-old.md": "Z" },
      [dir.homeAgents]: { "forge-engineer.md": "C" },
    });
    const { io, out } = fakeIo();
    const code = runVerifyInstall([], io, e.env);

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("extra");
    expect(out.join("\n")).toContain("forge-old.md");
  });

  test("rejects an unknown flag with usage (exit 2) and never touches the filesystem", () => {
    const e = env(checkoutCurrent, homeCurrent);
    const { io, err } = fakeIo();
    const code = runVerifyInstall(["--wat"], io, e.env);

    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/usage/i);
    expect(e.touched).toHaveLength(0);
  });

  test("only reads under the checkout and the injected Claude home (never the real ~/.claude)", () => {
    const e = env(checkoutCurrent, homeCurrent);
    const { io } = fakeIo();
    runVerifyInstall([], io, e.env);

    const allowedDirs = Object.values(dir);
    for (const touched of e.touched) {
      expect(allowedDirs.some((d) => touched.startsWith(d))).toBe(true);
    }
  });
});
