import { describe, expect, test } from "vitest";

import { parseFrontMatter } from "./front-matter.js";

describe("parseFrontMatter", () => {
  test("splits a YAML front-matter block from the body", () => {
    const raw = "---\nid: T03\nkind: green\n---\n# Title\n\nBody text.\n";

    const result = parseFrontMatter(raw);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.data).toEqual({ id: "T03", kind: "green" });
    expect(result.body).toBe("# Title\n\nBody text.\n");
  });

  test("reports missing front-matter when there is no leading delimiter", () => {
    const result = parseFrontMatter("# Title\n\nNo front-matter.\n");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.error).toMatch(/missing front-matter/i);
  });

  test("reports an unterminated front-matter block", () => {
    const result = parseFrontMatter("---\nid: T03\nbody never closed\n");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.error).toMatch(/unterminated/i);
  });

  test("reports invalid YAML inside the front-matter", () => {
    const result = parseFrontMatter("---\nfoo: [1, 2\n---\nbody\n");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.error).toMatch(/invalid yaml/i);
  });
});
