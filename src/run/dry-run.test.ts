import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { makeContract, makeSprint, makeTicket } from "../validate/test-builders.js";
import { gateRequiresHuman, planRun, runDryRun } from "./dry-run.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "validate", "__fixtures__");
const fx = (name: string): string => path.join(fixturesDir, name);

describe("gateRequiresHuman (effective gate → human-required rule)", () => {
  test('only "none" needs no human; merge/pr/phase/manual all require a human', () => {
    expect(gateRequiresHuman("none")).toBe(false);
    expect(gateRequiresHuman("merge")).toBe(true);
    expect(gateRequiresHuman("pr")).toBe(true);
    expect(gateRequiresHuman("phase")).toBe(true);
    expect(gateRequiresHuman("manual")).toBe(true);
  });
});

describe("planRun (ticket selection)", () => {
  test("selects the first pending ticket with no dependencies", () => {
    const report = planRun(makeContract());

    expect(report.ok).toBe(true);
    expect(report.selected?.ticket).toBe("T01");
    expect(report.agents).toEqual(["engineer", "semantic-verifier", "scope-verifier", "pm"]);
    expect(report.branch).toContain("forge/demo-epic/T01-");
  });

  test("skips merged tickets and selects the next pending one", () => {
    const contract = makeContract({
      sprints: [makeSprint({ tickets: [makeTicket({ id: "T01", status: "merged" }), makeTicket({ id: "T02", status: "pending" })] })],
    });
    expect(planRun(contract).selected?.ticket).toBe("T02");
  });

  test("selects a ticket whose dependencies are all merged", () => {
    const contract = makeContract({
      sprints: [
        makeSprint({
          tickets: [makeTicket({ id: "T01", status: "merged" }), makeTicket({ id: "T02", status: "pending", depends_on: ["T01"] })],
        }),
      ],
    });
    expect(planRun(contract).selected?.ticket).toBe("T02");
  });

  test("blocks when the only pending ticket depends on an unmerged ticket", () => {
    const contract = makeContract({
      sprints: [
        makeSprint({
          tickets: [makeTicket({ id: "T01", status: "engineering" }), makeTicket({ id: "T02", status: "pending", depends_on: ["T01"] })],
        }),
      ],
    });
    const report = planRun(contract);

    expect(report.ok).toBe(false);
    expect(report.selected).toBeUndefined();
    expect(report.blockedReasons.join("\n")).toMatch(/T02.*T01/);
  });

  test("blocks when no tickets are pending", () => {
    const contract = makeContract({ sprints: [makeSprint({ tickets: [makeTicket({ id: "T01", status: "merged" })] })] });
    const report = planRun(contract);

    expect(report.ok).toBe(false);
    expect(report.blockedReasons.length).toBeGreaterThan(0);
  });

  test("includes allowed/forbidden paths and verify commands for the selected ticket", () => {
    const contract = makeContract({
      sprints: [
        makeSprint({
          tickets: [makeTicket({ id: "T01", kind: "green", allowed_paths: ["src/**"], forbidden_paths: ["docs/**"], verify_commands: ["pnpm test"] })],
        }),
      ],
    });
    const report = planRun(contract);

    expect(report.allowedPaths).toEqual(["src/**"]);
    expect(report.forbiddenPaths).toEqual(["docs/**"]);
    expect(report.verifyCommands).toEqual(["pnpm test"]);
  });

  test("a manual-gate ticket is human-required", () => {
    const contract = makeContract({ sprints: [makeSprint({ tickets: [makeTicket({ id: "T01", gate: "manual" })] })] });
    const report = planRun(contract);

    expect(report.gate.effective).toBe("manual");
    expect(report.gate.humanRequired).toBe(true);
  });

  test("a high-risk ticket shows an effective manual gate via escalation", () => {
    const contract = makeContract({ sprints: [makeSprint({ tickets: [makeTicket({ id: "T01", change_class: "security", gate: "pr" })] })] });
    const report = planRun(contract);

    expect(report.gate.declared).toBe("pr");
    expect(report.gate.effective).toBe("manual");
    expect(report.gate.humanRequired).toBe(true);
  });
});

describe("runDryRun (from a contract path)", () => {
  test("selects the next ready ticket for a valid contract", () => {
    const report = runDryRun(fx("valid-epic"));

    expect(report.ok).toBe(true);
    expect(report.selected?.ticket).toBe("T01");
  });

  test("fails and reports validation errors when the contract does not validate", () => {
    const report = runDryRun(fx("invalid-ticket"));

    expect(report.ok).toBe(false);
    expect(report.selected).toBeUndefined();
    expect(report.blockedReasons.join("\n")).toMatch(/TICKET_SCHEMA_INVALID|validation/i);
  });
});
