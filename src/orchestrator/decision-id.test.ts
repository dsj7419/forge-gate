import { describe, expect, test } from "vitest";

import { nextDecisionId } from "./decision-id.js";

/**
 * Pure id-allocator tests. `nextDecisionId` is the deterministic seam Core uses
 * to compute the monotonic D-NNN id for the next PM decision from the ledger's
 * existing entries — it must be total, side-effect-free, and robust to garbage.
 */

describe("nextDecisionId — deterministic monotonic allocator", () => {
  test("empty list yields D-001", () => {
    expect(nextDecisionId([])).toBe("D-001");
  });

  test("contiguous run yields max+1", () => {
    expect(nextDecisionId(["D-001", "D-002"])).toBe("D-003");
  });

  test("gaps still yield max+1 (gaps are not back-filled)", () => {
    expect(nextDecisionId(["D-001", "D-003"])).toBe("D-004");
  });

  test("unordered input still yields max+1", () => {
    expect(nextDecisionId(["D-003", "D-001", "D-002"])).toBe("D-004");
  });

  test("zero-padded to width 3 until exceeded", () => {
    expect(nextDecisionId(["D-098"])).toBe("D-099");
    expect(nextDecisionId(["D-099"])).toBe("D-100");
  });

  test("natural width once width 3 is exceeded", () => {
    expect(nextDecisionId(["D-999"])).toBe("D-1000");
    expect(nextDecisionId(["D-1000", "D-1001"])).toBe("D-1002");
  });

  test("malformed entries are skipped without throwing", () => {
    expect(nextDecisionId(["", "D-", "D-abc", "X-001", "D-001"])).toBe("D-002");
  });

  test("a list of only malformed entries falls back to D-001", () => {
    expect(nextDecisionId(["junk", "", "D-?"])).toBe("D-001");
  });

  test("duplicate entries do not bump the counter twice", () => {
    expect(nextDecisionId(["D-001", "D-001", "D-002", "D-002"])).toBe("D-003");
  });

  test("does not mutate the input array", () => {
    const input = ["D-002", "D-001"];
    nextDecisionId(input);
    expect(input).toEqual(["D-002", "D-001"]);
  });
});
