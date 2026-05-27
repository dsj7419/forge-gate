/**
 * Read-only install-currency comparison for `forge verify-install`.
 *
 * Compares each `*.md` file in the checkout's `commands/` and `agents/`
 * directories against the matching file under the user's Claude config home,
 * classifying each as `current`, `missing`, or `stale`. Files present in the
 * installed location that have no checkout counterpart are reported as
 * informational `extra` and never affect the result's `ok`.
 *
 * The comparison reads and compares only; it performs no filesystem writes.
 * All filesystem access is funneled through the injected `InstallReader`, so
 * the logic is fully testable against fixtures and never touches the real
 * `~/.claude`.
 */

/** The kind of artifact a file is — drives where it is looked up and how it reports. */
export type InstallKind = "command" | "agent";

/** Per-file currency status. `extra` is informational and does not affect `ok`. */
export type InstallStatus = "current" | "missing" | "stale" | "extra";

export type InstallEntry = {
  kind: InstallKind;
  name: string;
  status: InstallStatus;
};

export type InstallReport = {
  ok: boolean;
  entries: InstallEntry[];
};

/** The only filesystem seam: list `*.md` in a dir and read one file's contents. */
export type InstallReader = {
  /** Returns the `*.md` file names directly in `dir` (sorted); `[]` if the dir is absent. */
  listMarkdown: (dir: string) => string[];
  /** Reads one file's UTF-8 contents; throws (ENOENT) if it does not exist. */
  readFile: (dir: string, name: string) => string;
};

export type CompareInstallOptions = {
  commandsCheckoutDir: string;
  agentsCheckoutDir: string;
  commandsInstalledDir: string;
  agentsInstalledDir: string;
  reader: InstallReader;
};

type DirPair = { kind: InstallKind; checkoutDir: string; installedDir: string };

export function compareInstall(options: CompareInstallOptions): InstallReport {
  const { reader } = options;
  const pairs: DirPair[] = [
    { kind: "command", checkoutDir: options.commandsCheckoutDir, installedDir: options.commandsInstalledDir },
    { kind: "agent", checkoutDir: options.agentsCheckoutDir, installedDir: options.agentsInstalledDir },
  ];

  const entries: InstallEntry[] = [];

  for (const pair of pairs) {
    const required = reader.listMarkdown(pair.checkoutDir);
    const installed = new Set(reader.listMarkdown(pair.installedDir));

    for (const name of required) {
      entries.push({ kind: pair.kind, name, status: classify(reader, pair, name, installed) });
    }

    // Informational `extra`: forge-*.md in the installed location with no checkout counterpart.
    const requiredSet = new Set(required);
    for (const name of installed) {
      if (!requiredSet.has(name) && name.startsWith("forge-")) {
        entries.push({ kind: pair.kind, name, status: "extra" });
      }
    }
  }

  const ok = entries.every((entry) => entry.status === "current" || entry.status === "extra");
  return { ok, entries };
}

function classify(reader: InstallReader, pair: DirPair, name: string, installed: Set<string>): InstallStatus {
  if (!installed.has(name)) return "missing";
  const checkoutContent = reader.readFile(pair.checkoutDir, name);
  const installedContent = reader.readFile(pair.installedDir, name);
  return checkoutContent === installedContent ? "current" : "stale";
}
