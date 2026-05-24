import { describe, expect, test } from "vitest";

import { buildReport, Code, error } from "../validate/findings.js";
import { makeContract } from "../validate/test-builders.js";
import { formatReportHuman, formatStatusHuman } from "./format.js";

describe("formatReportHuman", () => {
  test("renders an OK report", () => {
    const text = formatReportHuman(buildReport("/x/epic", []));

    expect(text).toContain("OK");
    expect(text).toContain("/x/epic");
    expect(text).toContain("0 findings");
  });

  test("renders a failed report with code, message and location", () => {
    const report = buildReport("/x/epic", [
      error(Code.EPIC_FILE_MISSING, "epic.yaml not found", { file: "epic.yaml" }),
    ]);
    const text = formatReportHuman(report);

    expect(text).toContain("FAILED");
    expect(text).toContain("EPIC_FILE_MISSING");
    expect(text).toContain("epic.yaml not found");
  });
});

describe("formatStatusHuman", () => {
  test("summarizes epic id, sprints, ticket counts and finding totals", () => {
    const contract = makeContract();
    const text = formatStatusHuman(contract, []);

    expect(text).toContain("demo-epic");
    expect(text).toContain("sprint-05-foundation");
    expect(text).toContain("0 findings");
  });
});
