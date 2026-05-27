import { describe, expect, test } from "vitest";

import { compareInstall, type InstallReader } from "./verify-install.js";

/**
 * A pure in-memory reader: the checkout and the installed Claude home are both
 * modeled as `dir -> { fileName -> contents }`. No real filesystem is touched.
 */
type Tree = Record<string, Record<string, string>>;

function reader(checkout: Tree, claudeHome: Tree): { reader: InstallReader; reads: string[] } {
  const reads: string[] = [];
  const join = (...parts: string[]): string => parts.join("/");
  const lookup = (tree: Tree, dir: string): Record<string, string> | undefined => tree[dir];

  return {
    reads,
    reader: {
      listMarkdown: (dir) => {
        reads.push(`list:${dir}`);
        const entry = lookup({ ...checkout, ...claudeHome }, dir);
        return entry === undefined ? [] : Object.keys(entry).filter((n) => n.endsWith(".md")).sort();
      },
      readFile: (dir, name) => {
        reads.push(`read:${join(dir, name)}`);
        const entry = lookup({ ...checkout, ...claudeHome }, dir);
        const content = entry?.[name];
        if (content === undefined) {
          const error = new Error(`ENOENT: ${join(dir, name)}`) as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }
        return content;
      },
    },
  };
}

const dirs = {
  checkoutCommands: "/checkout/commands",
  checkoutAgents: "/checkout/agents",
  homeCommands: "/home/.claude/commands",
  homeAgents: "/home/.claude/agents",
} as const;

function compareWith(checkout: Tree, claudeHome: Tree): ReturnType<typeof compareInstall> {
  const built = reader(checkout, claudeHome);
  return compareInstall({
    commandsCheckoutDir: dirs.checkoutCommands,
    agentsCheckoutDir: dirs.checkoutAgents,
    commandsInstalledDir: dirs.homeCommands,
    agentsInstalledDir: dirs.homeAgents,
    reader: built.reader,
  });
}

describe("compareInstall — install-currency comparison", () => {
  test("reports every required file current and ok when all installed copies are byte-identical", () => {
    const result = compareWith(
      {
        [dirs.checkoutCommands]: { "forge-validate.md": "A", "forge-status.md": "B" },
        [dirs.checkoutAgents]: { "forge-engineer.md": "C" },
      },
      {
        [dirs.homeCommands]: { "forge-validate.md": "A", "forge-status.md": "B" },
        [dirs.homeAgents]: { "forge-engineer.md": "C" },
      },
    );

    expect(result.ok).toBe(true);
    const statuses = Object.fromEntries(result.entries.map((e) => [e.name, e.status]));
    expect(statuses).toEqual({
      "forge-validate.md": "current",
      "forge-status.md": "current",
      "forge-engineer.md": "current",
    });
  });

  test("reports a missing command file and is not ok", () => {
    const result = compareWith(
      { [dirs.checkoutCommands]: { "forge-validate.md": "A" }, [dirs.checkoutAgents]: {} },
      { [dirs.homeCommands]: {}, [dirs.homeAgents]: {} },
    );

    expect(result.ok).toBe(false);
    const entry = result.entries.find((e) => e.name === "forge-validate.md");
    expect(entry?.status).toBe("missing");
    expect(entry?.kind).toBe("command");
  });

  test("reports a missing agent file and is not ok", () => {
    const result = compareWith(
      { [dirs.checkoutCommands]: {}, [dirs.checkoutAgents]: { "forge-engineer.md": "C" } },
      { [dirs.homeCommands]: {}, [dirs.homeAgents]: {} },
    );

    expect(result.ok).toBe(false);
    const entry = result.entries.find((e) => e.name === "forge-engineer.md");
    expect(entry?.status).toBe("missing");
    expect(entry?.kind).toBe("agent");
  });

  test("reports a stale command file (content differs) and is not ok", () => {
    const result = compareWith(
      { [dirs.checkoutCommands]: { "forge-validate.md": "NEW" }, [dirs.checkoutAgents]: {} },
      { [dirs.homeCommands]: { "forge-validate.md": "OLD" }, [dirs.homeAgents]: {} },
    );

    expect(result.ok).toBe(false);
    expect(result.entries.find((e) => e.name === "forge-validate.md")?.status).toBe("stale");
  });

  test("reports a stale agent file (content differs) and is not ok", () => {
    const result = compareWith(
      { [dirs.checkoutCommands]: {}, [dirs.checkoutAgents]: { "forge-engineer.md": "NEW" } },
      { [dirs.homeCommands]: {}, [dirs.homeAgents]: { "forge-engineer.md": "OLD" } },
    );

    expect(result.ok).toBe(false);
    expect(result.entries.find((e) => e.name === "forge-engineer.md")?.status).toBe("stale");
  });

  test("an installed forge-*.md with no checkout counterpart is informational `extra` and keeps ok=true", () => {
    const result = compareWith(
      { [dirs.checkoutCommands]: { "forge-validate.md": "A" }, [dirs.checkoutAgents]: {} },
      {
        [dirs.homeCommands]: { "forge-validate.md": "A", "forge-something-old.md": "Z" },
        [dirs.homeAgents]: {},
      },
    );

    expect(result.ok).toBe(true); // extra does not flip ok
    const extra = result.entries.find((e) => e.name === "forge-something-old.md");
    expect(extra?.status).toBe("extra");
  });

  test("only the checkout's *.md files form the required set", () => {
    const result = compareWith(
      {
        [dirs.checkoutCommands]: { "forge-validate.md": "A", "notes.txt": "ignored" },
        [dirs.checkoutAgents]: {},
      },
      { [dirs.homeCommands]: { "forge-validate.md": "A" }, [dirs.homeAgents]: {} },
    );

    expect(result.ok).toBe(true);
    expect(result.entries.some((e) => e.name === "notes.txt")).toBe(false);
  });

  test("never reads or lists anything outside the four injected directories", () => {
    const built = reader(
      { [dirs.checkoutCommands]: { "forge-validate.md": "A" }, [dirs.checkoutAgents]: { "forge-engineer.md": "C" } },
      { [dirs.homeCommands]: { "forge-validate.md": "A" }, [dirs.homeAgents]: { "forge-engineer.md": "C" } },
    );
    compareInstall({
      commandsCheckoutDir: dirs.checkoutCommands,
      agentsCheckoutDir: dirs.checkoutAgents,
      commandsInstalledDir: dirs.homeCommands,
      agentsInstalledDir: dirs.homeAgents,
      reader: built.reader,
    });

    const touched = built.reads.map((r) => r.split(":")[1] ?? "");
    const allowed = Object.values(dirs);
    for (const path of touched) {
      expect(allowed.some((dir) => path.startsWith(dir))).toBe(true);
    }
  });
});
