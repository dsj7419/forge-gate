import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

import { planImport } from "./plan.js";
import { executeImport } from "./write.js";

const legacy = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "legacy-sprint-5");
const tempDirs: string[] = [];

function emptyOutDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-import-"));
  tempDirs.push(dir);
  return dir;
}

function unusedOutPath(): string {
  const dir = path.join(os.tmpdir(), `forge-import-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

describe("executeImport (live write)", () => {
  test("writes canonical files, preserves prose, runs validation, and leaves the source intact", () => {
    const out = unusedOutPath();
    const sourceFilesBefore = fs.readdirSync(legacy).length;

    const result = executeImport(legacy, out);

    expect(result.wrote).toBe(true);
    expect(result.createdFiles).toContain("epic.yaml");
    expect(result.createdFiles).toContain("sprint-05-imported/manifest.yaml");
    expect(result.createdFiles).toContain("sprint-05-imported/tickets/T01-planning.md");
    expect(fs.existsSync(path.join(out, "epic.yaml"))).toBe(true);
    expect(fs.readFileSync(path.join(out, "sprint-05-imported", "SPRINT.md"), "utf8")).toContain("legacy sprint overview");
    expect(fs.readFileSync(path.join(out, "sprint-05-imported", "tickets", "T01-planning.md"), "utf8")).toContain("Sprint plan written");
    expect(result.validation).toBeDefined();
    expect(fs.readdirSync(legacy).length).toBe(sourceFilesBefore);
  });

  test("flags the generated contract as not execution-ready when fields were ambiguous, keeping ambiguity visible", () => {
    const result = executeImport(legacy, unusedOutPath());

    expect(result.generatedContractValid).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.validation?.findings.map((finding) => finding.code)).toContain("TICKET_SCHEMA_INVALID");
    expect(result.importFindings.map((finding) => finding.code)).toContain("IMPORT_AMBIGUOUS_RISK");
  });

  test("writes an import report under .forge", () => {
    const out = unusedOutPath();
    executeImport(legacy, out);
    expect(fs.existsSync(path.join(out, ".forge", "import-report.json"))).toBe(true);
  });

  test("refuses to write into a non-empty output directory", () => {
    const out = emptyOutDir();
    fs.writeFileSync(path.join(out, "existing.txt"), "hi");

    const result = executeImport(legacy, out);

    expect(result.wrote).toBe(false);
    expect(result.importFindings.map((finding) => finding.code)).toContain("IMPORT_OUTPUT_EXISTS");
    expect(fs.existsSync(path.join(out, "epic.yaml"))).toBe(false);
  });

  test("uses an existing empty output directory", () => {
    const result = executeImport(legacy, emptyOutDir());
    expect(result.wrote).toBe(true);
  });

  test("reports IMPORT_SOURCE_MISSING and writes nothing for a missing source", () => {
    const out = unusedOutPath();
    const result = executeImport(path.join(legacy, "does-not-exist"), out);

    expect(result.wrote).toBe(false);
    expect(result.importFindings.map((finding) => finding.code)).toContain("IMPORT_SOURCE_MISSING");
    expect(fs.existsSync(out)).toBe(false);
  });

  test("dry-run planning still writes nothing", () => {
    const out = unusedOutPath();
    planImport(legacy, out, { dryRun: true });
    expect(fs.existsSync(out)).toBe(false);
  });
});
