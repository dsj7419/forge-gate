import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { planImport } from "./plan.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const legacy = path.join(fixturesDir, "legacy-sprint-5");
const nonexistentOut = (): string => path.join(os.tmpdir(), `forge-import-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);

describe("planImport (dry-run)", () => {
  test("produces a dry-run plan that writes nothing and leaves the source intact", () => {
    const out = nonexistentOut();
    const plan = planImport(legacy, out, { dryRun: true });

    expect(plan.dryRun).toBe(true);
    expect(fs.existsSync(out)).toBe(false); // planning wrote nothing
    expect(fs.existsSync(legacy)).toBe(true); // source untouched
    expect(plan.files.every((file) => file.action === "would_create")).toBe(true);
  });

  test("lists the canonical target files", () => {
    const plan = planImport(legacy, "/virtual/docs/epics/demo", { dryRun: true });
    const targets = plan.files.map((file) => file.targetFile);

    expect(targets).toContain("epic.yaml");
    expect(targets).toContain("EPIC.md");
    expect(targets).toContain("DECISIONS.md");
    expect(targets).toContain("sprint-05-imported/SPRINT.md");
    expect(targets).toContain("sprint-05-imported/manifest.yaml");
    expect(targets).toContain("sprint-05-imported/JOURNAL.md");
    expect(targets).toContain("sprint-05-imported/tickets/T01-planning.md");
    expect(targets).toContain("sprint-05-imported/tickets/T02-impl.md");
  });

  test("flags ambiguity and missing acceptance without inventing facts", () => {
    const plan = planImport(legacy, "/virtual/docs/epics/demo", { dryRun: true });
    const codes = plan.findings.map((finding) => finding.code);

    // T02 has no metadata and no acceptance section.
    expect(codes).toContain("IMPORT_AMBIGUOUS_RISK");
    expect(codes).toContain("IMPORT_AMBIGUOUS_CHANGE_CLASS");
    expect(codes).toContain("IMPORT_AMBIGUOUS_BLAST_RADIUS");
    expect(codes).toContain("IMPORT_MISSING_ACCEPTANCE_CRITERIA");
    expect(codes).toContain("IMPORT_AMBIGUOUS_VERIFY_COMMANDS"); // T02 is a green ticket with no commands
    // Unknown file is skipped, decisions migrated, dry-run noted.
    expect(codes).toContain("IMPORT_SKIPPED_UNKNOWN_FILE");
    expect(codes).toContain("IMPORT_DECISIONS_MIGRATED");
    expect(codes).toContain("IMPORT_DRY_RUN_ONLY");
  });

  test("preserves prose by referencing the legacy source files", () => {
    const plan = planImport(legacy, "/virtual/docs/epics/demo", { dryRun: true });
    const prosePreserved = plan.findings.filter((finding) => finding.code === "IMPORT_PROSE_PRESERVED");

    expect(prosePreserved.length).toBeGreaterThanOrEqual(1);
    expect(prosePreserved.some((finding) => finding.sourceFile === "README.md")).toBe(true);
    expect(prosePreserved.some((finding) => finding.sourceFile === "T01-planning.md")).toBe(true);
  });

  test("does not flag a complete legacy ticket (T01 has metadata + acceptance)", () => {
    const plan = planImport(legacy, "/virtual/docs/epics/demo", { dryRun: true });
    const t01Findings = plan.findings.filter((finding) => finding.sourceFile === "T01-planning.md");

    // Only the info "prose preserved" finding; no ambiguity/missing-acceptance for T01.
    expect(t01Findings.map((finding) => finding.code)).toEqual(["IMPORT_PROSE_PRESERVED"]);
  });

  test("reports IMPORT_SOURCE_MISSING for a non-existent source", () => {
    const plan = planImport(path.join(fixturesDir, "does-not-exist"), "/virtual/out", { dryRun: true });

    expect(plan.ok).toBe(false);
    expect(plan.files).toEqual([]);
    expect(plan.findings.map((finding) => finding.code)).toContain("IMPORT_SOURCE_MISSING");
  });
});
