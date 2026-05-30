import { describe, expect, test } from "vitest";

import { ACTIVE_TICKET_SCHEMA, loadActiveTicket, parseActiveTicket } from "./active-ticket.js";
import { GuardCode } from "./path-guard.js";

const valid = {
  schema: ACTIVE_TICKET_SCHEMA,
  repo_root: "/repo",
  epic_path: "docs/epics/x",
  ticket: "T01",
  branch: "forge/x/T01-slug",
  allowed_paths: ["src/example/**"],
  forbidden_paths: ["package.json"],
  protected_paths: ["**/manifest.yaml"],
};

describe("parseActiveTicket", () => {
  test("parses a well-formed v1 active ticket", () => {
    const result = parseActiveTicket(JSON.stringify(valid));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.ticket.repo_root).toBe("/repo");
    expect(result.ticket.ticket).toBe("T01");
    expect(result.ticket.allowed_paths).toEqual(["src/example/**"]);
    expect(result.ticket.protected_paths).toEqual(["**/manifest.yaml"]);
  });

  test("tolerates and strips unknown producer fields (phase, timestamp, epic, sprint)", () => {
    const enriched = { ...valid, epic: "x", sprint: "sprint-01", phase: "execute", timestamp: "2026-05-25T00:00:00Z" };

    const result = parseActiveTicket(JSON.stringify(enriched));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.ticket).not.toHaveProperty("epic");
    expect(result.ticket).not.toHaveProperty("phase");
    expect(result.ticket.ticket).toBe("T01");
  });

  test("round-trips a valid typed gate object", () => {
    const withGate = { ...valid, gate: { declared: "pr", effective: "pr", human_required: true } };

    const result = parseActiveTicket(JSON.stringify(withGate));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.ticket.gate).toEqual({ declared: "pr", effective: "pr", human_required: true });
  });

  test("still accepts an active-ticket without a gate (the field is optional)", () => {
    const result = parseActiveTicket(JSON.stringify(valid));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.ticket.gate).toBeUndefined();
  });

  test("rejects a malformed gate (wrong type) as ACTIVE_TICKET_INVALID", () => {
    const result = parseActiveTicket(JSON.stringify({ ...valid, gate: "pr" }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe(GuardCode.ACTIVE_TICKET_INVALID);
  });

  test("rejects a gate missing a sub-field as ACTIVE_TICKET_INVALID", () => {
    const result = parseActiveTicket(JSON.stringify({ ...valid, gate: { declared: "pr", effective: "pr" } }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe(GuardCode.ACTIVE_TICKET_INVALID);
  });

  test("rejects a gate with an extra sub-key as ACTIVE_TICKET_INVALID (strict nested object)", () => {
    const result = parseActiveTicket(
      JSON.stringify({ ...valid, gate: { declared: "pr", effective: "pr", human_required: true, extra: "x" } }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe(GuardCode.ACTIVE_TICKET_INVALID);
  });

  test("rejects an empty gate sub-field string as ACTIVE_TICKET_INVALID", () => {
    const result = parseActiveTicket(
      JSON.stringify({ ...valid, gate: { declared: "", effective: "pr", human_required: true } }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe(GuardCode.ACTIVE_TICKET_INVALID);
  });

  test("rejects malformed JSON as ACTIVE_TICKET_INVALID", () => {
    const result = parseActiveTicket("{ not valid json");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe(GuardCode.ACTIVE_TICKET_INVALID);
  });

  test("rejects a wrong schema tag as ACTIVE_TICKET_INVALID", () => {
    const result = parseActiveTicket(JSON.stringify({ ...valid, schema: "something-else" }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe(GuardCode.ACTIVE_TICKET_INVALID);
  });

  test("rejects a relative repo_root — the wrong-cwd guard requires an absolute path", () => {
    const result = parseActiveTicket(JSON.stringify({ ...valid, repo_root: "." }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe(GuardCode.ACTIVE_TICKET_INVALID);
    expect(result.message).toMatch(/absolute/i);
  });

  test("rejects a missing load-bearing field rather than silently accepting it", () => {
    const { repo_root: _omitted, ...withoutRepoRoot } = valid;

    const result = parseActiveTicket(JSON.stringify(withoutRepoRoot));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe(GuardCode.ACTIVE_TICKET_INVALID);
    expect(result.message).toMatch(/repo_root/);
  });
});

describe("loadActiveTicket", () => {
  test("reports ACTIVE_TICKET_MISSING when the file does not exist", () => {
    const result = loadActiveTicket("/repo/.forge/active-ticket.json", () => {
      const error = new Error("ENOENT: no such file") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe(GuardCode.ACTIVE_TICKET_MISSING);
  });

  test("parses an existing file through the injected reader", () => {
    const result = loadActiveTicket("/repo/.forge/active-ticket.json", () => JSON.stringify(valid));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.ticket.ticket).toBe("T01");
  });
});
