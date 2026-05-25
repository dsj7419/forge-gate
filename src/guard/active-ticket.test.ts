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

  test("tolerates and strips unknown producer fields (gate, phase, timestamp, epic, sprint)", () => {
    const enriched = { ...valid, epic: "x", sprint: "sprint-01", gate: "pr", phase: "execute", timestamp: "2026-05-25T00:00:00Z" };

    const result = parseActiveTicket(JSON.stringify(enriched));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.ticket).not.toHaveProperty("gate");
    expect(result.ticket).not.toHaveProperty("phase");
    expect(result.ticket.ticket).toBe("T01");
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
