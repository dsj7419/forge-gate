import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { buildPmDispatch } from "./dispatch.js";
import { generateRunPackets, type RunPacketSet } from "./packets.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const agentsDir = path.join(repoRoot, "agents");
const sandboxEpic = path.join(repoRoot, "sandbox-epic");
const options = { registeredAvailable: false as const, agentsDir };

function packets(): RunPacketSet {
  const result = generateRunPackets(sandboxEpic, repoRoot);
  if (!result.ok) throw new Error("expected packets");
  return result.packets;
}

const ENGINEER = [
  "ticket: T01",
  "summary: add a pure add() helper",
  "files_changed: [{ path: src/sandbox/add.ts, adds: 3, dels: 0 }]",
  "tests: { added: 2, changed: 0 }",
  "commands_run: [{ cmd: pnpm test, result: pass }]",
  "within_allowed_paths: true",
  "",
].join("\n");

const SEMANTIC = [
  "verdict: APPROVE",
  'acceptance_checked: [{ id: 1, status: met, evidence: "add.ts:1" }]',
  "findings: []",
  "risk_level: low",
  "",
].join("\n");

const SCOPE = [
  "verdict: APPROVE",
  "changed_files: [src/sandbox/add.ts]",
  "allowed_path_status: clean",
  "forbidden_path_violations: []",
  "unexpected_files: []",
  "recommendation: in scope",
  "",
].join("\n");

const FACTS = JSON.stringify({
  parse_validation: { engineer: true, semantic_verifier: true, scope_verifier: true },
  verify_command_results: [{ cmd: "pnpm test", result: "pass" }],
  final_changed_files: ["src/sandbox/add.ts", "src/sandbox/add.test.ts"],
  final_branch_status: { branch: "forge/sandbox-epic/T01-add", ahead_of_base: 0, committed: false },
});

function build(overrides: Partial<{ engineer: string; semantic: string; scope: string; facts: string }> = {}) {
  return buildPmDispatch(
    packets(),
    { engineer: ENGINEER, semantic: SEMANTIC, scope: SCOPE, facts: FACTS, ...overrides },
    options,
  );
}

describe("buildPmDispatch — deterministic PM input assembly", () => {
  test("valid engineer/semantic/scope/facts produce a PM dispatch (general-purpose + injected charter)", () => {
    const result = build();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dispatch.role).toBe("pm");
    expect(result.dispatch.subagent_type).toBe("general-purpose");
    expect(result.dispatch.mode).toBe("injected-charter");
    expect(result.dispatch.prompt).toContain("You are the **Forge PM**"); // charter injected verbatim
  });

  test("prompt carries the validated engineer output structure", () => {
    const result = build();
    if (!result.ok) throw new Error("expected ok");
    expect(result.dispatch.prompt).toContain("add a pure add() helper"); // engineer summary, not a paraphrase
  });

  test("prompt carries the validated semantic verdict structure", () => {
    const result = build();
    if (!result.ok) throw new Error("expected ok");
    expect(result.dispatch.prompt).toContain("acceptance_checked"); // semantic-distinct field
  });

  test("prompt carries the validated scope verdict structure", () => {
    const result = build();
    if (!result.ok) throw new Error("expected ok");
    expect(result.dispatch.prompt).toContain("allowed_path_status"); // scope-distinct field
  });

  test("prompt carries the orchestrator-confirmed changed files", () => {
    const result = build();
    if (!result.ok) throw new Error("expected ok");
    // add.test.ts is in the facts but NOT the sample scope output — proves the facts were rendered.
    expect(result.dispatch.prompt).toContain("src/sandbox/add.test.ts");
  });

  test("prompt carries the verify-command results", () => {
    const result = build();
    if (!result.ok) throw new Error("expected ok");
    expect(result.dispatch.prompt).toContain("pnpm test => pass");
  });

  test("prompt carries the branch / ahead-of-base state", () => {
    const result = build();
    if (!result.ok) throw new Error("expected ok");
    expect(result.dispatch.prompt).toContain("forge/sandbox-epic/T01-add");
    expect(result.dispatch.prompt).toContain("ahead_of_base");
  });

  test("prompt carries the cwd-discipline statement", () => {
    const result = build();
    if (!result.ok) throw new Error("expected ok");
    expect(result.dispatch.prompt).toContain("Evidence gathered outside repo_root is invalid evidence.");
  });

  test("prompt carries the known harness limitations", () => {
    const result = build();
    if (!result.ok) throw new Error("expected ok");
    expect(result.dispatch.prompt).toContain("Known harness limitations");
  });

  test("prompt surfaces the authoritative, Core-derived human_gate_required from the effective gate", () => {
    const result = build();
    if (!result.ok) throw new Error("expected ok");
    // sandbox-epic T01 is gate: pr -> human required. The PM must be told this, not left to guess.
    expect(result.dispatch.prompt).toContain("Effective gate (authoritative");
    expect(result.dispatch.prompt).toContain("human_gate_required: true");
  });

  test("invalid engineer output fails (AGENT_OUTPUT_INVALID, source engineer)", () => {
    const result = build({ engineer: "summary: missing required fields\n" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("AGENT_OUTPUT_INVALID");
    expect(result.source).toBe("engineer");
  });

  test("invalid semantic output fails (source semantic-verifier)", () => {
    const result = build({ semantic: "verdict: MAYBE\n" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("AGENT_OUTPUT_INVALID");
    expect(result.source).toBe("semantic-verifier");
  });

  test("invalid scope output fails (source scope-verifier)", () => {
    const result = build({ scope: "verdict: APPROVE\nallowed_path_status: maybe\nrecommendation: x\n" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("AGENT_OUTPUT_INVALID");
    expect(result.source).toBe("scope-verifier");
  });

  test("malformed facts JSON fails (FACTS_INVALID)", () => {
    const result = build({ facts: "{ not json" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("FACTS_INVALID");
  });

  test("schema-invalid facts fail (FACTS_INVALID)", () => {
    const result = build({ facts: JSON.stringify({ final_changed_files: ["x"] }) }); // missing required keys
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("FACTS_INVALID");
  });

  test("a filled PM dispatch does not mutate the source packet skeleton", () => {
    const p = packets();
    buildPmDispatch(p, { engineer: ENGINEER, semantic: SEMANTIC, scope: SCOPE, facts: FACTS }, options);
    expect(p.pm.inputs.engineer_output).toBeNull(); // pure: the input packet stays a skeleton
  });
});
