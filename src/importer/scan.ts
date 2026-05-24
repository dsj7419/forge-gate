import * as fs from "node:fs";
import * as path from "node:path";

export type LegacyFileKind = "overview" | "decisions" | "ticket" | "unknown";

export type ScannedFile = {
  /** Path relative to the legacy source root (posix). */
  file: string;
  basename: string;
  kind: LegacyFileKind;
  text: string;
};

export type ScanResult = {
  sourceExists: boolean;
  files: ScannedFile[];
};

function classify(name: string): LegacyFileKind {
  const lower = name.toLowerCase();
  if (/^t\d+/i.test(name)) return "ticket";
  if (lower.includes("decision")) return "decisions";
  if (lower === "readme.md" || lower.includes("overview") || lower.includes("sprint")) return "overview";
  return "unknown";
}

/**
 * Reads a legacy sprint folder (one level deep) and classifies each file.
 * Read-only: never writes and never touches the source beyond reading.
 */
export function scanLegacySprint(sourcePath: string): ScanResult {
  let entries: string[];
  try {
    entries = fs.readdirSync(sourcePath);
  } catch {
    return { sourceExists: false, files: [] };
  }

  const files: ScannedFile[] = [];
  for (const name of [...entries].sort()) {
    const full = path.join(sourcePath, name);
    let isFile: boolean;
    try {
      isFile = fs.statSync(full).isFile();
    } catch {
      continue;
    }
    if (!isFile) continue;

    let text = "";
    try {
      text = fs.readFileSync(full, "utf8");
    } catch {
      text = "";
    }
    files.push({ file: name, basename: name, kind: classify(name), text });
  }
  return { sourceExists: true, files };
}
