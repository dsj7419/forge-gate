import { describe, expect, test } from "vitest";

import { TicketFrontMatterSchema } from "./ticket.js";

const validTicket = {
  schema_version: 1,
  id: "T03",
  title: "Runtime actor GREEN",
  kind: "green",
  risk: "medium",
  change_class: "feature",
  blast_radius: "module",
  status: "pending",
  gate: "pr",
  allowed_paths: ["internal/runtime/**"],
  verify_commands: ["task test"],
};

describe("TicketFrontMatterSchema", () => {
  test("parses a valid ticket and applies array/boolean/verifier defaults", () => {
    const result = TicketFrontMatterSchema.safeParse(validTicket);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(JSON.stringify(result.error.issues));
    expect(result.data.depends_on).toEqual([]);
    expect(result.data.blocks).toEqual([]);
    expect(result.data.adrs).toEqual([]);
    expect(result.data.forbidden_paths).toEqual([]);
    expect(result.data.gate_override).toBe(false);
    expect(result.data.verifier).toBe("two-pass");
  });

  test("rejects a missing required field (id)", () => {
    const withoutId: Record<string, unknown> = { ...validTicket };
    delete withoutId.id;
    expect(TicketFrontMatterSchema.safeParse(withoutId).success).toBe(false);
  });

  test("rejects an invalid enum value (kind)", () => {
    expect(TicketFrontMatterSchema.safeParse({ ...validTicket, kind: "blue" }).success).toBe(false);
  });

  test("rejects an unknown key (strict)", () => {
    expect(TicketFrontMatterSchema.safeParse({ ...validTicket, bogus: true }).success).toBe(false);
  });

  test("rejects a malformed ticket id", () => {
    expect(TicketFrontMatterSchema.safeParse({ ...validTicket, id: "ticket-3" }).success).toBe(false);
  });

  test("rejects an unsupported schema_version", () => {
    expect(TicketFrontMatterSchema.safeParse({ ...validTicket, schema_version: 2 }).success).toBe(false);
  });

  test("rejects a single-digit ticket id (T1)", () => {
    expect(TicketFrontMatterSchema.safeParse({ ...validTicket, id: "T1" }).success).toBe(false);
  });

  test("rejects a whitespace-only title", () => {
    expect(TicketFrontMatterSchema.safeParse({ ...validTicket, title: "   " }).success).toBe(false);
  });

  test("rejects an empty allowed_paths entry", () => {
    expect(TicketFrontMatterSchema.safeParse({ ...validTicket, allowed_paths: [""] }).success).toBe(false);
  });

  test("rejects a whitespace-only verify_commands entry", () => {
    expect(TicketFrontMatterSchema.safeParse({ ...validTicket, verify_commands: ["  "] }).success).toBe(false);
  });

  test("rejects gate_override true without a rationale", () => {
    expect(TicketFrontMatterSchema.safeParse({ ...validTicket, gate_override: true }).success).toBe(false);
  });

  test("accepts gate_override true with a rationale", () => {
    const result = TicketFrontMatterSchema.safeParse({
      ...validTicket,
      gate_override: true,
      gate_override_rationale: "security ticket: human pre-approved auto-merge",
    });
    expect(result.success).toBe(true);
  });
});
