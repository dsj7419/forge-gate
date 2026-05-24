import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { loadContract } from "./load.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const fx = (name: string): string => path.join(fixturesDir, name);

describe("loadContract", () => {
  test("loads a valid epic into typed data with no findings", () => {
    const result = loadContract(fx("valid-epic"));

    expect(result.findings).toEqual([]);
    const contract = result.contract;
    if (!contract) throw new Error("expected a contract for valid input");
    expect(contract.epic.id).toBe("demo-epic");
    expect(contract.sprints).toHaveLength(1);
    expect(contract.sprints[0]?.id).toBe("sprint-05-foundation");
    expect(contract.sprints[0]?.tickets).toHaveLength(1);
    expect(contract.sprints[0]?.tickets[0]?.frontMatter.id).toBe("T01");
    expect(contract.sprints[0]?.tickets[0]?.body).toContain("Acceptance Criteria");
  });

  test("reports EPIC_FILE_MISSING and returns no contract when epic.yaml is absent", () => {
    const result = loadContract(fx("no-epic"));

    expect(result.contract).toBeUndefined();
    expect(result.findings.map((finding) => finding.code)).toContain("EPIC_FILE_MISSING");
  });

  test("reports EPIC_SCHEMA_INVALID for a malformed epic.yaml", () => {
    const result = loadContract(fx("invalid-epic"));

    expect(result.contract).toBeUndefined();
    expect(result.findings.map((finding) => finding.code)).toContain("EPIC_SCHEMA_INVALID");
  });

  test("reports MANIFEST_FILE_MISSING when a referenced sprint has no manifest", () => {
    const result = loadContract(fx("missing-manifest"));

    expect(result.findings.map((finding) => finding.code)).toContain("MANIFEST_FILE_MISSING");
    expect(result.contract?.sprints).toHaveLength(0);
  });

  test("reports MANIFEST_SCHEMA_INVALID and skips the bad sprint", () => {
    const result = loadContract(fx("invalid-manifest"));

    expect(result.findings.map((finding) => finding.code)).toContain("MANIFEST_SCHEMA_INVALID");
    expect(result.contract?.sprints).toHaveLength(0);
  });

  test("reports ticket-level findings while still loading the valid surrounding sprint", () => {
    const result = loadContract(fx("invalid-ticket"));

    const codes = result.findings.map((finding) => finding.code);
    expect(codes).toContain("TICKET_SCHEMA_INVALID");
    expect(codes).toContain("TICKET_FRONT_MATTER_INVALID");
    expect(result.contract?.sprints).toHaveLength(1);
    expect(result.contract?.sprints[0]?.tickets).toHaveLength(0);
  });
});
