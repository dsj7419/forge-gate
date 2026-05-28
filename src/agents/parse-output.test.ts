import { describe, expect, test } from "vitest";

import { parseAgentOutput } from "./parse-output.js";

const engineerValid = `
ticket: T01
summary: implemented the runtime actor
files_changed:
  - { path: internal/runtime/actor.go, adds: 40, dels: 0 }
tests: { added: 3, changed: 0 }
commands_run:
  - { cmd: task test, result: pass }
within_allowed_paths: true
`;

const semanticValid = `
verdict: APPROVE
acceptance_checked:
  - { id: 1, status: met, evidence: "actor_test.go:TestActor_Submit" }
findings: []
risk_level: low
`;

const scopeValid = `
verdict: APPROVE
changed_files: [internal/runtime/actor.go]
allowed_path_status: clean
recommendation: scope is clean
`;

const pmValid = `
decision: PASS
rationale: both verifiers approved with cited evidence
decision_id: D-001
journal_entry: T01 passed review
human_gate_required: true
`;

describe("parseAgentOutput — valid outputs", () => {
  test("a valid engineer output parses", () => {
    const result = parseAgentOutput("engineer", engineerValid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.ticket).toBe("T01");
  });

  test("a valid semantic-verifier output parses", () => {
    expect(parseAgentOutput("semantic-verifier", semanticValid).ok).toBe(true);
  });

  test("a valid scope-verifier output parses", () => {
    expect(parseAgentOutput("scope-verifier", scopeValid).ok).toBe(true);
  });

  test("a valid pm output parses", () => {
    expect(parseAgentOutput("pm", pmValid).ok).toBe(true);
  });
});

describe("parseAgentOutput — rejections (AGENT_OUTPUT_INVALID)", () => {
  test("engineer output missing commands_run fails", () => {
    const raw = engineerValid.replace(/commands_run:\n  - \{ cmd: task test, result: pass \}\n/, "");
    const result = parseAgentOutput("engineer", raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("AGENT_OUTPUT_INVALID");
  });

  test("semantic-verifier output with an acceptance entry missing evidence fails", () => {
    const raw = `
verdict: APPROVE
acceptance_checked:
  - { id: 1, status: met }
findings: []
risk_level: low
`;
    expect(parseAgentOutput("semantic-verifier", raw).ok).toBe(false);
  });

  test("semantic-verifier prose-only 'looks good' fails", () => {
    expect(parseAgentOutput("semantic-verifier", "looks good").ok).toBe(false);
  });

  test("scope-verifier with an invalid verdict fails", () => {
    const raw = scopeValid.replace("verdict: APPROVE", "verdict: MAYBE");
    expect(parseAgentOutput("scope-verifier", raw).ok).toBe(false);
  });

  test("pm output missing decision and rationale fails", () => {
    const raw = `
decision_id: D-001
journal_entry: x
human_gate_required: false
`;
    expect(parseAgentOutput("pm", raw).ok).toBe(false);
  });

  test("pm output with an invalid decision enum fails", () => {
    const raw = pmValid.replace("decision: PASS", "decision: MAYBE");
    expect(parseAgentOutput("pm", raw).ok).toBe(false);
  });

  test("malformed YAML fails", () => {
    expect(parseAgentOutput("scope-verifier", "verdict: [unclosed").ok).toBe(false);
  });

  test("an unknown top-level field fails (strict)", () => {
    const raw = `${engineerValid}\nbogus_field: true\n`;
    expect(parseAgentOutput("engineer", raw).ok).toBe(false);
  });

  // Characterization: pin the exact fragility that caused a real AGENT_OUTPUT_INVALID
  // halt. An acceptance_checked entry written as an inline flow mapping whose evidence
  // is an unquoted, comma-bearing scalar gets split at the comma — the trailing fragment
  // becomes a spurious key (value null), which the strict schema rejects. Core stays
  // strict: the malformed output is rejected, never repaired into something valid.
  test("a flow-style acceptance entry with an unquoted comma-bearing scalar is rejected (not repaired)", () => {
    const raw = `
verdict: APPROVE
acceptance_checked:
  - { id: 1, status: met, evidence: actor_test.go:line 5, TestActor }
findings: []
risk_level: low
`;
    const result = parseAgentOutput("semantic-verifier", raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("AGENT_OUTPUT_INVALID");
  });

  // The block-style, quoted form the hardened charter now prescribes for the same
  // entry parses cleanly — proving the charter guidance steers agents to valid output.
  test("the block-style quoted form of the same acceptance entry is accepted", () => {
    const raw = `
verdict: APPROVE
acceptance_checked:
  - id: 1
    status: met
    evidence: "actor_test.go:line 5, TestActor"
findings: []
risk_level: low
`;
    expect(parseAgentOutput("semantic-verifier", raw).ok).toBe(true);
  });
});

describe("parseAgentOutput — fenced YAML extraction", () => {
  const fence = (body: string, tag = "yaml"): string => "```" + tag + "\n" + body.trim() + "\n```\n";

  test("plain YAML (no fence) still parses — unchanged behavior", () => {
    expect(parseAgentOutput("pm", pmValid).ok).toBe(true);
  });

  test("exactly one ```yaml fenced block parses (its contents only)", () => {
    const result = parseAgentOutput("pm", fence(pmValid));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.decision).toBe("PASS");
  });

  test("prose before and after a single fenced block still parses (extract the block)", () => {
    const raw = `Here is my decision and reasoning.\n\n${fence(pmValid)}\nThat completes the review.`;
    expect(parseAgentOutput("pm", raw).ok).toBe(true);
  });

  test("a ```yml (alt tag) fenced block parses", () => {
    expect(parseAgentOutput("pm", fence(pmValid, "yml")).ok).toBe(true);
  });

  test("a non-YAML code fence is ignored — one ```yaml block alongside a ```json block still extracts the yaml", () => {
    const raw = `${fence(pmValid)}\nFor reference:\n\`\`\`json\n{"note":"ignored"}\n\`\`\`\n`;
    expect(parseAgentOutput("pm", raw).ok).toBe(true);
  });

  test("multiple ```yaml fenced blocks fail (ambiguous)", () => {
    const raw = `${fence(pmValid)}\n${fence(pmValid)}`;
    const result = parseAgentOutput("pm", raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("AGENT_OUTPUT_INVALID");
  });

  test("malformed YAML inside a single fence fails", () => {
    expect(parseAgentOutput("pm", "```yaml\ndecision: [unclosed\n```").ok).toBe(false);
  });

  test("a schema-invalid object inside a fence still fails", () => {
    expect(parseAgentOutput("pm", fence(pmValid.replace("decision: PASS", "decision: MAYBE"))).ok).toBe(false);
  });

  test("prose-only with no fence and no YAML object fails", () => {
    expect(parseAgentOutput("pm", "I reviewed the change and it looks complete to me.").ok).toBe(false);
  });

  test("a non-YAML fence only (no yaml block) fails clearly", () => {
    const raw = "Result below:\n```json\n{\"decision\":\"PASS\"}\n```\n";
    expect(parseAgentOutput("pm", raw).ok).toBe(false);
  });

  test("the extracted object is validated against the role schema (engineer)", () => {
    const result = parseAgentOutput("engineer", `done:\n\n${fence(engineerValid)}`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.ticket).toBe("T01");
  });
});
