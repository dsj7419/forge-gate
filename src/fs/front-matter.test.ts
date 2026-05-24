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

describe("parseFrontMatter — hardening", () => {
  test("parses CRLF line endings", () => {
    const result = parseFrontMatter("---\r\nid: T03\r\n---\r\nbody");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.data).toEqual({ id: "T03" });
    expect(result.body).toBe("body");
  });

  test("allows empty front-matter at the parser layer (schema layer rejects it for tickets)", () => {
    const result = parseFrontMatter("---\n---\nbody\n");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    // Parser is permissive: empty front-matter yields a nullish value.
    // Ticket validity (must be an object with required fields) is enforced by the schema layer.
    expect(result.data == null).toBe(true);
  });

  test("only a bare '---' line closes the block; '--- something' does not", () => {
    // The '--- not a delimiter' line must NOT close the block, so with no real
    // closing delimiter the block is unterminated. A naive startsWith('---')
    // implementation would wrongly close here.
    const result = parseFrontMatter("---\nid: T03\n--- not a delimiter\n");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.error).toMatch(/unterminated/i);
  });

  test("allows a scalar/string root at the parser layer (schema layer rejects non-objects)", () => {
    const result = parseFrontMatter("---\njust a scalar\n---\nbody\n");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(typeof result.data).toBe("string");
  });
});
