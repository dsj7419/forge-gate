import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { generateRunPackets, OrchestratorConfirmedFactsSchema } from "./packets.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const validEpic = path.join(repoRoot, "src", "validate", "__fixtures__", "valid-epic");
const invalidTicket = path.join(repoRoot, "src", "validate", "__fixtures__", "invalid-ticket");
const sandboxEpic = path.join(repoRoot, "sandbox-epic");

function packetsFor(epicPath: string, root: string = repoRoot) {
  const result = generateRunPackets(epicPath, root);
  if (!result.ok) throw new Error(`expected ok packets, got blocked: ${result.blockedReasons.join("; ")}`);
  return result.packets;
}

describe("generateRunPackets", () => {
  test("every packet pins an absolute repo_root equal to required_cwd", () => {
    const packets = packetsFor(validEpic, "."); // even a relative root is resolved to absolute
    for (const packet of [packets.engineer, packets.semantic_verifier, packets.scope_verifier, packets.pm]) {
      expect(path.isAbsolute(packet.repo_root)).toBe(true);
      expect(packet.required_cwd).toBe(packet.repo_root);
    }
  });

  test("every packet carries the cwd-discipline statements", () => {
    const packets = packetsFor(validEpic);
    for (const packet of [packets.engineer, packets.semantic_verifier, packets.scope_verifier, packets.pm]) {
      expect(packet.cwd_discipline).toContain("Evidence gathered outside repo_root is invalid evidence.");
      expect(packet.cwd_discipline.length).toBeGreaterThanOrEqual(4);
    }
  });

  test("packets carry the ticket's allowed/forbidden paths", () => {
    const packets = packetsFor(sandboxEpic);
    expect(packets.engineer.allowed_paths).toEqual(["src/sandbox/**"]);
    expect(packets.engineer.forbidden_paths).toEqual(["sandbox-epic/**"]);
    expect(packets.active_run.allowed_paths).toEqual(["src/sandbox/**"]);
    expect(packets.scope_verifier.protected_paths.length).toBeGreaterThan(0);
  });

  test("the PM packet has slots for the validated structured agent outputs (null in the skeleton)", () => {
    const packets = packetsFor(validEpic);
    expect(packets.pm.inputs.engineer_output).toBeNull();
    expect(packets.pm.inputs.semantic_verifier_output).toBeNull();
    expect(packets.pm.inputs.scope_verifier_output).toBeNull();
  });

  test("the PM packet has a slot for orchestrator-confirmed facts and known harness limitations", () => {
    const packets = packetsFor(validEpic);
    expect(packets.pm.inputs.orchestrator_confirmed_facts).toBeNull();
    expect(packets.pm.known_harness_limitations.length).toBeGreaterThan(0);
  });

  test("the PM packet has an assigned_decision_id slot defaulted to null in the skeleton", () => {
    const packets = packetsFor(validEpic);
    expect(packets.pm.inputs.assigned_decision_id).toBeNull();
  });

  test("the engineer packet carries the full ticket body, acceptance, AI instructions, verify commands, and file path", () => {
    const p = packetsFor(sandboxEpic).engineer;
    expect(p.ticket_body).toContain("## Scope");
    expect(p.ticket_body).toContain("## Acceptance Criteria");
    expect(p.ticket_body).toContain("exports a pure function"); // acceptance text
    expect(p.ticket_body).toContain("Create `src/sandbox/add.ts`"); // AI instructions text
    expect(p.verify_commands).toEqual(["pnpm test"]);
    expect(p.ticket_file).toContain("tickets/T01");
  });

  test("the semantic-verifier packet carries acceptance criteria and verify commands", () => {
    const p = packetsFor(sandboxEpic).semantic_verifier;
    expect(p.acceptance).toContain("exports a pure function");
    expect(p.verify_commands).toEqual(["pnpm test"]);
    expect(p.ticket_file).toContain("tickets/T01");
  });

  test("generation fails when forge run --dry-run is blocked (invalid contract)", () => {
    const result = generateRunPackets(invalidTicket, repoRoot);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected blocked");
    expect(result.blockedReasons.length).toBeGreaterThan(0);
  });

  test("generation writes nothing under the epic path", () => {
    const before = fs.readdirSync(validEpic, { recursive: true }).map(String).sort();
    generateRunPackets(validEpic, repoRoot);
    const after = fs.readdirSync(validEpic, { recursive: true }).map(String).sort();
    expect(after).toEqual(before);
  });
});

describe("OrchestratorConfirmedFactsSchema", () => {
  test("rejects facts whose parse_validation is missing the pm flag", () => {
    // Facts that pre-date the pm flag — every other required field is present
    // and well-typed, so the only reason to reject is the missing `pm`.
    const factsMissingPm = {
      parse_validation: { engineer: true, semantic_verifier: true, scope_verifier: true },
      verify_command_results: [{ cmd: "pnpm test", result: "pass" }],
      final_changed_files: ["src/sandbox/add.ts"],
      final_branch_status: { branch: "forge/sandbox/T01", ahead_of_base: 0, committed: false },
    };
    const result = OrchestratorConfirmedFactsSchema.safeParse(factsMissingPm);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path.join(".") === "parse_validation.pm")).toBe(true);
  });

  test("accepts facts that include parse_validation.pm: true", () => {
    const facts = {
      parse_validation: { engineer: true, semantic_verifier: true, scope_verifier: true, pm: true },
      verify_command_results: [{ cmd: "pnpm test", result: "pass" }],
      final_changed_files: ["src/sandbox/add.ts"],
      final_branch_status: { branch: "forge/sandbox/T01", ahead_of_base: 0, committed: false },
    };
    const result = OrchestratorConfirmedFactsSchema.safeParse(facts);
    expect(result.success).toBe(true);
  });
});
