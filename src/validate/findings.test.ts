import { describe, expect, test } from "vitest";

import { buildReport, Code, error, warning } from "./findings.js";

describe("finding helpers", () => {
  test("error() produces an error-severity finding with location fields", () => {
    const finding = error(Code.DUPLICATE_TICKET_ID, "duplicate id T03", {
      sprint: "sprint-05-foundation",
      ticket: "T03",
    });

    expect(finding).toEqual({
      code: "DUPLICATE_TICKET_ID",
      severity: "error",
      message: "duplicate id T03",
      sprint: "sprint-05-foundation",
      ticket: "T03",
    });
  });

  test("warning() produces a warning-severity finding and omits absent location fields", () => {
    const finding = warning(Code.PATH_GLOB_OVERLAP, "heads up");

    expect(finding.severity).toBe("warning");
    expect(finding.file).toBeUndefined();
    expect(finding.sprint).toBeUndefined();
    expect(finding.ticket).toBeUndefined();
  });

  test("buildReport ok is false when any finding is an error", () => {
    const report = buildReport("/epic", [
      warning(Code.PATH_GLOB_OVERLAP, "w"),
      error(Code.DEPENDENCY_CYCLE, "e"),
    ]);

    expect(report.ok).toBe(false);
    expect(report.findings).toHaveLength(2);
  });

  test("buildReport ok is true when there are no error findings", () => {
    const report = buildReport("/epic", [warning(Code.PATH_GLOB_OVERLAP, "w")]);

    expect(report.ok).toBe(true);
    expect(report.epicPath).toBe("/epic");
  });
});
