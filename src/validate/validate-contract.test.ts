import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { validateContract } from "./validate-contract.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const fx = (name: string): string => path.join(fixturesDir, name);

describe("validateContract", () => {
  test("returns an ok report with no findings for a clean, ready epic", () => {
    const report = validateContract(fx("valid-epic"));

    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.epicPath).toBe(fx("valid-epic"));
  });

  test("reports a load failure (and is not ok) when epic.yaml is missing", () => {
    const report = validateContract(fx("no-epic"));

    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toContain("EPIC_FILE_MISSING");
  });

  test("surfaces schema findings from the load stage", () => {
    const report = validateContract(fx("invalid-ticket"));

    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toContain("TICKET_SCHEMA_INVALID");
  });

  test("runs the readiness stage on a contract that loads cleanly but is not execution-ready", () => {
    const report = validateContract(fx("unready-epic"));

    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toContain("VERIFY_COMMANDS_REQUIRED");
  });
});
