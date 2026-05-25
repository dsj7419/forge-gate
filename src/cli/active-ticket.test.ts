import { describe, expect, test } from "vitest";

import { ACTIVE_TICKET_SCHEMA, ActiveTicketSchema } from "../guard/active-ticket.js";
import type { ActiveRun } from "../orchestrator/packets.js";
import { buildActiveTicket } from "./active-ticket.js";

const activeRun: ActiveRun = {
  repo_root: "/abs/repo",
  epic_path: "docs/epics/x",
  sprint: "sprint-01",
  ticket: "T01",
  branch: "forge/x/T01-slug",
  allowed_paths: ["src/feature/**"],
  forbidden_paths: ["package.json"],
  protected_paths: ["**/manifest.yaml"],
  gate: { declared: "pr", effective: "pr", human_required: true },
};

describe("buildActiveTicket", () => {
  test("maps a packet active_run to a forge-active-ticket/v1 object", () => {
    const ticket = buildActiveTicket(activeRun);

    expect(ticket.schema).toBe(ACTIVE_TICKET_SCHEMA);
    expect(ticket.repo_root).toBe("/abs/repo");
    expect(ticket.epic_path).toBe("docs/epics/x");
    expect(ticket.ticket).toBe("T01");
    expect(ticket.branch).toBe("forge/x/T01-slug");
    expect(ticket.allowed_paths).toEqual(["src/feature/**"]);
    expect(ticket.forbidden_paths).toEqual(["package.json"]);
    expect(ticket.protected_paths).toEqual(["**/manifest.yaml"]);
  });

  test("emits only v1 fields — the operational gate/sprint are not carried", () => {
    const ticket = buildActiveTicket(activeRun);

    expect(ticket).not.toHaveProperty("gate");
    expect(ticket).not.toHaveProperty("sprint");
  });

  test("the emitted object validates against the consumer's ActiveTicketSchema", () => {
    const ticket = buildActiveTicket(activeRun);

    expect(ActiveTicketSchema.safeParse(ticket).success).toBe(true);
  });
});
