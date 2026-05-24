import { describe, expect, test } from "vitest";

import { validateIntegrity } from "./integrity.js";
import { makeContract, makeEntry, makeSprint, makeTicket } from "./test-builders.js";

const codesOf = (contract: Parameters<typeof validateIntegrity>[0]): string[] =>
  validateIntegrity(contract).map((finding) => finding.code);

describe("validateIntegrity", () => {
  test("returns no findings for a clean contract", () => {
    expect(validateIntegrity(makeContract())).toEqual([]);
  });

  test("detects duplicate ticket ids across the whole epic", () => {
    const contract = makeContract({
      sprints: [
        makeSprint({ id: "sprint-05-foundation", tickets: [makeTicket({ id: "T01" })] }),
        makeSprint({ id: "sprint-06-runtime", tickets: [makeTicket({ id: "T01" })] }),
      ],
    });
    expect(codesOf(contract)).toContain("DUPLICATE_TICKET_ID");
  });

  test("detects a manifest sprint id that differs from the epic's sprint id", () => {
    const contract = makeContract({
      sprints: [makeSprint({ id: "sprint-05-foundation", manifestSprint: "sprint-99-other" })],
    });
    expect(codesOf(contract)).toContain("MANIFEST_SPRINT_ID_MISMATCH");
  });

  test("detects a manifest entry with no corresponding ticket file", () => {
    const contract = makeContract({
      sprints: [makeSprint({ tickets: [makeTicket({ id: "T01" })], entries: [makeEntry({ id: "T01" }), makeEntry({ id: "T03" })] })],
    });
    expect(codesOf(contract)).toContain("MANIFEST_TICKET_MISSING_FILE");
  });

  test("detects a ticket file not listed in the manifest", () => {
    const contract = makeContract({
      sprints: [makeSprint({ tickets: [makeTicket({ id: "T01" }), makeTicket({ id: "T03" })], entries: [makeEntry({ id: "T01" })] })],
    });
    expect(codesOf(contract)).toContain("TICKET_NOT_IN_MANIFEST");
  });

  test("detects a ticket filename whose prefix does not match its id", () => {
    const ticket = makeTicket({ id: "T04" }, { file: "sprint-05-foundation/tickets/T03-something.md" });
    const contract = makeContract({
      sprints: [makeSprint({ tickets: [ticket], entries: [makeEntry({ id: "T04" })] })],
    });
    expect(codesOf(contract)).toContain("TICKET_FILENAME_ID_MISMATCH");
  });

  test("detects a missing dependency target", () => {
    const contract = makeContract({
      sprints: [makeSprint({ tickets: [makeTicket({ id: "T01", depends_on: ["T99"] })], entries: [makeEntry({ id: "T01", depends_on: ["T99"] })] })],
    });
    expect(codesOf(contract)).toContain("DEPENDENCY_MISSING");
  });

  test("detects a missing block target", () => {
    const contract = makeContract({
      sprints: [makeSprint({ tickets: [makeTicket({ id: "T01", blocks: ["T99"] })], entries: [makeEntry({ id: "T01", blocks: ["T99"] })] })],
    });
    expect(codesOf(contract)).toContain("BLOCK_TARGET_MISSING");
  });

  test("detects a dependency cycle", () => {
    const contract = makeContract({
      sprints: [
        makeSprint({
          tickets: [makeTicket({ id: "T01", depends_on: ["T02"] }), makeTicket({ id: "T02", depends_on: ["T01"] })],
          entries: [makeEntry({ id: "T01", depends_on: ["T02"] }), makeEntry({ id: "T02", depends_on: ["T01"] })],
        }),
      ],
    });
    expect(codesOf(contract)).toContain("DEPENDENCY_CYCLE");
  });

  test("detects a manifest/ticket status mismatch", () => {
    const contract = makeContract({
      sprints: [makeSprint({ tickets: [makeTicket({ id: "T01", status: "pending" })], entries: [makeEntry({ id: "T01", status: "engineering" })] })],
    });
    expect(codesOf(contract)).toContain("MANIFEST_TICKET_STATUS_MISMATCH");
  });

  test("detects a manifest/ticket kind mismatch", () => {
    const contract = makeContract({
      sprints: [makeSprint({ tickets: [makeTicket({ id: "T01", kind: "green" })], entries: [makeEntry({ id: "T01", kind: "red" })] })],
    });
    expect(codesOf(contract)).toContain("MANIFEST_TICKET_KIND_MISMATCH");
  });

  test("detects a manifest/ticket depends_on mismatch (compared as sets)", () => {
    const contract = makeContract({
      sprints: [
        makeSprint({
          tickets: [makeTicket({ id: "T01", depends_on: ["T02"] }), makeTicket({ id: "T02" })],
          entries: [makeEntry({ id: "T01", depends_on: [] }), makeEntry({ id: "T02" })],
        }),
      ],
    });
    expect(codesOf(contract)).toContain("MANIFEST_TICKET_DEPENDENCY_MISMATCH");
  });

  test("detects a manifest/ticket blocks mismatch (compared as sets)", () => {
    const contract = makeContract({
      sprints: [
        makeSprint({
          tickets: [makeTicket({ id: "T01", blocks: ["T02"] }), makeTicket({ id: "T02" })],
          entries: [makeEntry({ id: "T01", blocks: [] }), makeEntry({ id: "T02" })],
        }),
      ],
    });
    expect(codesOf(contract)).toContain("MANIFEST_TICKET_BLOCKS_MISMATCH");
  });
});
