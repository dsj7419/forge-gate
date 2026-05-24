import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";

import { parseFrontMatter } from "../fs/front-matter.js";
import { EpicSchema } from "../schema/epic.js";
import { ManifestSchema } from "../schema/manifest.js";
import { TicketFrontMatterSchema } from "../schema/ticket.js";
import { generateEpicYaml, generateManifestYaml, generateSprintMd, generateTicketMd } from "./generate.js";
import type { DerivedTicket } from "./plan.js";

function derived(overrides: Partial<DerivedTicket>): DerivedTicket {
  return {
    basename: "T01-impl.md",
    sourceFile: "T01-impl.md",
    id: "T01",
    idAmbiguous: false,
    title: "A ticket: with colon",
    kind: "green",
    risk: "low",
    change_class: "feature",
    blast_radius: "module",
    hasAcceptance: true,
    body: "# A ticket\n\n## Acceptance Criteria\n\n- [ ] it works\n",
    ...overrides,
  };
}

describe("content generators", () => {
  test("generateEpicYaml produces EpicSchema-valid YAML", () => {
    const data = parseYaml(generateEpicYaml("demo-epic", "sprint-05-imported"));
    expect(EpicSchema.safeParse(data).success).toBe(true);
  });

  test("generateManifestYaml with known kinds is ManifestSchema-valid", () => {
    const data = parseYaml(generateManifestYaml("sprint-05-imported", [{ id: "T01", kind: "green" }]));
    expect(ManifestSchema.safeParse(data).success).toBe(true);
  });

  test("generateTicketMd for a fully-known ticket is schema-valid and preserves prose", () => {
    const md = generateTicketMd(derived({}));
    const fm = parseFrontMatter(md);

    expect(fm.ok).toBe(true);
    if (!fm.ok) throw new Error("expected front-matter");
    expect(TicketFrontMatterSchema.safeParse(fm.data).success).toBe(true);
    expect(fm.body).toContain("Acceptance Criteria");
    expect(md).toContain("gate_override: false");
  });

  test("generateTicketMd writes TODO for ambiguous fields and stays schema-invalid until completed", () => {
    const md = generateTicketMd(derived({ risk: undefined, body: "# T\n\noriginal legacy prose\n" }));

    expect(md).toContain("risk: TODO");
    const fm = parseFrontMatter(md);
    expect(fm.ok).toBe(true);
    if (!fm.ok) throw new Error("expected front-matter");
    expect(TicketFrontMatterSchema.safeParse(fm.data).success).toBe(false);
    expect(fm.body).toContain("original legacy prose");
  });

  test("generateSprintMd preserves the legacy overview prose", () => {
    expect(generateSprintMd("legacy overview text here")).toContain("legacy overview text here");
  });
});
