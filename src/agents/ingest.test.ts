import { describe, expect, test } from "vitest";

import { ingestAgentOutput } from "./ingest.js";

const engineerValidObj = {
  ticket: "T01",
  summary: "implemented the actor",
  files_changed: [{ path: "src/x.ts", adds: 40, dels: 0 }],
  tests: { added: 3, changed: 0 },
  commands_run: [{ cmd: "pnpm test", result: "pass" }],
  within_allowed_paths: true,
};

const semanticValidObj = {
  verdict: "APPROVE",
  acceptance_checked: [{ id: 1, status: "met", evidence: "x_test.ts:Test" }],
  findings: [],
  risk_level: "low",
};

const scopeValidObj = {
  verdict: "APPROVE",
  changed_files: ["src/x.ts"],
  allowed_path_status: "clean",
  recommendation: "scope is clean",
};

const pmValidObj = {
  decision: "PASS",
  rationale: "both verifiers approved",
  decision_id: "D-001",
  journal_entry: "T01 passed review",
  human_gate_required: true,
};

describe("ingestAgentOutput — structured source", () => {
  test("accepts a valid engineer object", () => {
    const r = ingestAgentOutput("engineer", { source: "structured", value: engineerValidObj });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.ticket).toBe("T01");
  });

  test("accepts a valid semantic-verifier object", () => {
    expect(ingestAgentOutput("semantic-verifier", { source: "structured", value: semanticValidObj }).ok).toBe(true);
  });

  test("accepts a valid scope-verifier object", () => {
    expect(ingestAgentOutput("scope-verifier", { source: "structured", value: scopeValidObj }).ok).toBe(true);
  });

  test("accepts a valid pm object", () => {
    expect(ingestAgentOutput("pm", { source: "structured", value: pmValidObj }).ok).toBe(true);
  });

  test("rejects an invalid engineer object (missing fields)", () => {
    const r = ingestAgentOutput("engineer", { source: "structured", value: { summary: "x" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("AGENT_OUTPUT_INVALID");
  });

  test("rejects an invalid semantic-verifier object", () => {
    expect(ingestAgentOutput("semantic-verifier", { source: "structured", value: { verdict: "MAYBE" } }).ok).toBe(false);
  });

  test("rejects an invalid scope-verifier object", () => {
    const bad = { ...scopeValidObj, verdict: "MAYBE" };
    expect(ingestAgentOutput("scope-verifier", { source: "structured", value: bad }).ok).toBe(false);
  });

  test("rejects an invalid pm object (bad decision enum)", () => {
    const bad = { ...pmValidObj, decision: "MAYBE" };
    expect(ingestAgentOutput("pm", { source: "structured", value: bad }).ok).toBe(false);
  });

  test("rejects PM CORRECT with empty instructions (refinement enforced by Zod, not JSON Schema)", () => {
    const bad = { ...pmValidObj, decision: "CORRECT", instructions: [] };
    const r = ingestAgentOutput("pm", { source: "structured", value: bad });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("AGENT_OUTPUT_INVALID");
  });

  test("rejects PM malformed decision_id (pattern enforced by Zod)", () => {
    const bad = { ...pmValidObj, decision_id: "X-1" };
    expect(ingestAgentOutput("pm", { source: "structured", value: bad }).ok).toBe(false);
  });

  test("rejects engineer negative adds/dels (bounds enforced by Zod)", () => {
    const bad = { ...engineerValidObj, files_changed: [{ path: "src/x.ts", adds: -1, dels: -2 }] };
    expect(ingestAgentOutput("engineer", { source: "structured", value: bad }).ok).toBe(false);
  });

  test("rejects a null value (mirrors YAML scalar rejection)", () => {
    const r = ingestAgentOutput("engineer", { source: "structured", value: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("AGENT_OUTPUT_INVALID");
  });

  test("rejects an array value (mirrors YAML scalar rejection)", () => {
    const r = ingestAgentOutput("engineer", { source: "structured", value: [engineerValidObj] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("AGENT_OUTPUT_INVALID");
  });

  test("rejects a scalar value", () => {
    expect(ingestAgentOutput("engineer", { source: "structured", value: "looks good" }).ok).toBe(false);
  });
});

describe("ingestAgentOutput — yaml source delegates to parseAgentOutput", () => {
  const engineerYaml = `
ticket: T01
summary: implemented the actor
files_changed:
  - { path: src/x.ts, adds: 40, dels: 0 }
tests: { added: 3, changed: 0 }
commands_run:
  - { cmd: pnpm test, result: pass }
within_allowed_paths: true
`;

  test("accepts a valid YAML engineer output", () => {
    const r = ingestAgentOutput("engineer", { source: "yaml", text: engineerYaml });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.ticket).toBe("T01");
  });

  test("rejects malformed YAML", () => {
    const r = ingestAgentOutput("scope-verifier", { source: "yaml", text: "verdict: [unclosed" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("AGENT_OUTPUT_INVALID");
  });

  test("rejects prose-only YAML scalar", () => {
    expect(ingestAgentOutput("semantic-verifier", { source: "yaml", text: "looks good" }).ok).toBe(false);
  });
});
