import { describe, expect, test } from "vitest";

import { parsePorcelain } from "./git.js";

// `git status --porcelain -z`: NUL-terminated records with paths emitted verbatim
// (no core.quotePath quoting). A rename is two NUL records — the new path carrying
// the `XY ` prefix, then the bare original path.
describe("parsePorcelain (NUL-delimited -z form)", () => {
  test("extracts modified, added, and untracked paths", () => {
    const out = " M src/a.ts\0A  src/b.ts\0?? src/c.ts\0";

    expect(parsePorcelain(out)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  test("extracts a deleted path", () => {
    expect(parsePorcelain(" D src/gone.ts\0")).toEqual(["src/gone.ts"]);
  });

  test("extracts both sides of a rename (new then original, each its own NUL record)", () => {
    expect(parsePorcelain("R  src/new.ts\0src/old.ts\0")).toEqual(["src/new.ts", "src/old.ts"]);
  });

  test("preserves a path containing spaces verbatim — the quoting fence-bypass regression", () => {
    expect(parsePorcelain("?? src/secret file.ts\0")).toEqual(["src/secret file.ts"]);
  });

  test("preserves spaces on both sides of a renamed path", () => {
    expect(parsePorcelain("R  src/new name.ts\0src/old name.ts\0")).toEqual(["src/new name.ts", "src/old name.ts"]);
  });

  test("returns nothing for empty output", () => {
    expect(parsePorcelain("")).toEqual([]);
  });

  test("handles a mixed status with a rename, deduping repeats", () => {
    const out = " M README.md\0R  a.ts\0z.ts\0?? a.ts\0";

    expect(parsePorcelain(out)).toEqual(["README.md", "a.ts", "z.ts"]);
  });
});
