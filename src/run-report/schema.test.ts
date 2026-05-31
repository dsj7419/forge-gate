import { describe, expect, test } from "vitest";

import { RunReportSchema, type RunReport } from "./schema.js";

/**
 * Schema tests for the Core-owned `forge-run-report/v1` artifact. The schema is
 * the v1 safety thesis in code: every `safety.*` boolean is `z.literal(false)`,
 * the top level is strict (no drift), and `decision_id` must match `D-<digits>`.
 *
 * The fixture is the smallest fully-populated valid v1 report. Each rejection
 * test mutates one field at a time so failures point at exactly one violation.
 */
const VALID: RunReport = {
  schema: "forge-run-report/v1",
  command: "/forge-run-ticket",
  result: "PASS",
  epic_path: "D:/Projects/forge/docs/epics/example",
  target_repo: "D:/Projects/forge",
  ticket: "T01",
  ticket_title: "Example ticket",
  branch: "forge/example/T01-example",
  decision: "PASS",
  decision_id: "D-001",
  human_gate_required: true,
  gate: { declared: "pr", effective: "pr", human_required: true },
  checkpoint: { base: "abc123", head: "abc123" },
  parse_validation: { engineer: true, semantic_verifier: true, scope_verifier: true, pm: true },
  verify_command_results: [
    { cmd: "pnpm test", result: "pass" },
    { cmd: "pnpm typecheck", result: "pass" },
  ],
  guard: { result: "OK", exit: 0 },
  verifiers: { semantic: "APPROVE", scope: "APPROVE" },
  final_changed_files: ["src/run-report/schema.ts"],
  final_branch_status: {
    branch: "forge/example/T01-example",
    ahead_of_base: 0,
    committed: false,
  },
  agent_outputs: {
    engineer: ".forge/engineer-output.yaml",
    semantic_verifier: ".forge/semantic-verifier-output.yaml",
    scope_verifier: ".forge/scope-verifier-output.yaml",
    pm: ".forge/pm-output.yaml",
  },
  safety: {
    committed: false,
    pushed: false,
    pr_opened: false,
    merged: false,
    status_write_back: false,
    journal_written: false,
  },
};

describe("RunReportSchema — accepts a fully-populated valid v1 report", () => {
  test("the canonical VALID fixture parses ok and round-trips", () => {
    const parsed = RunReportSchema.safeParse(VALID);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.schema).toBe("forge-run-report/v1");
    expect(parsed.data.command).toBe("/forge-run-ticket");
    expect(parsed.data.result).toBe("PASS");
    expect(parsed.data.decision_id).toBe("D-001");
  });

  test("ESCALATE is an accepted top-level result", () => {
    const parsed = RunReportSchema.safeParse({ ...VALID, result: "ESCALATE" });
    expect(parsed.success).toBe(true);
  });

  test("optional commit_gate_materials and notes are accepted when present", () => {
    const parsed = RunReportSchema.safeParse({
      ...VALID,
      commit_gate_materials: {
        proposed_status_transition: "T01 pending -> ready_for_pr (proposed)",
        suggested_commit_message: "feat: add foo",
        suggested_commands: ["git add x", "git commit -m \"feat: add foo\""],
      },
      notes: ["transport noise observed", "bootstrap note"],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("RunReportSchema — rejects each missing required field", () => {
  const REQUIRED_FIELDS: (keyof RunReport)[] = [
    "schema",
    "command",
    "result",
    "epic_path",
    "target_repo",
    "ticket",
    "ticket_title",
    "branch",
    "decision",
    "decision_id",
    "human_gate_required",
    "gate",
    "checkpoint",
    "parse_validation",
    "verify_command_results",
    "guard",
    "verifiers",
    "final_changed_files",
    "final_branch_status",
    "agent_outputs",
    "safety",
  ];

  for (const field of REQUIRED_FIELDS) {
    test(`rejects a report missing ${field}`, () => {
      const broken: Record<string, unknown> = { ...VALID };
      delete broken[field];
      const parsed = RunReportSchema.safeParse(broken);
      expect(parsed.success).toBe(false);
    });
  }
});

describe("RunReportSchema — rejects schema drift", () => {
  test("rejects an unknown top-level field (strict)", () => {
    const parsed = RunReportSchema.safeParse({ ...VALID, transport_note: "drifted" });
    expect(parsed.success).toBe(false);
  });

  test("rejects a non-v1 schema literal", () => {
    const parsed = RunReportSchema.safeParse({ ...VALID, schema: "forge-run-report/v2" });
    expect(parsed.success).toBe(false);
  });

  test("rejects a command other than /forge-run-ticket", () => {
    const parsed = RunReportSchema.safeParse({ ...VALID, command: "/forge-other" });
    expect(parsed.success).toBe(false);
  });

  test("rejects a malformed decision_id", () => {
    const parsed = RunReportSchema.safeParse({ ...VALID, decision_id: "X-1" });
    expect(parsed.success).toBe(false);
  });

  test("rejects a non-pinned result (CORRECT is not a terminal result)", () => {
    const parsed = RunReportSchema.safeParse({ ...VALID, result: "CORRECT" });
    expect(parsed.success).toBe(false);
  });
});

describe("RunReportSchema — optional agent_output_source (trust-path provenance)", () => {
  test("accepts a report WITHOUT agent_output_source (backward-compatible)", () => {
    const parsed = RunReportSchema.safeParse(VALID);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty("agent_output_source");
  });

  test("accepts agent_output_source populated with all four known roles", () => {
    const parsed = RunReportSchema.safeParse({
      ...VALID,
      agent_output_source: {
        engineer: "yaml_text",
        semantic_verifier: "yaml_text",
        scope_verifier: "structured_json",
        pm: "yaml_text",
      },
    });
    expect(parsed.success).toBe(true);
  });

  test("accepts each enum value: yaml_text, structured_json, workflow_core_runner", () => {
    for (const value of ["yaml_text", "structured_json", "workflow_core_runner"]) {
      const parsed = RunReportSchema.safeParse({
        ...VALID,
        agent_output_source: { engineer: value },
      });
      expect(parsed.success).toBe(true);
    }
  });

  test("accepts a subset of roles (each role individually optional)", () => {
    const parsed = RunReportSchema.safeParse({
      ...VALID,
      agent_output_source: { pm: "structured_json" },
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects an unknown source value (e.g. made_up)", () => {
    const parsed = RunReportSchema.safeParse({
      ...VALID,
      agent_output_source: { engineer: "made_up" },
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects an unknown role key inside agent_output_source (inner strict)", () => {
    const parsed = RunReportSchema.safeParse({
      ...VALID,
      agent_output_source: { engineer: "yaml_text", reviewer: "yaml_text" },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("RunReportSchema — safety.* booleans are z.literal(false)", () => {
  const SAFETY_FLAGS = [
    "committed",
    "pushed",
    "pr_opened",
    "merged",
    "status_write_back",
    "journal_written",
  ] as const;

  for (const flag of SAFETY_FLAGS) {
    test(`rejects safety.${flag} = true (literal false only)`, () => {
      const parsed = RunReportSchema.safeParse({
        ...VALID,
        safety: { ...VALID.safety, [flag]: true },
      });
      expect(parsed.success).toBe(false);
    });
  }

  test("rejects a missing safety boolean", () => {
    const { committed: _omit, ...safetyMissing } = VALID.safety;
    const parsed = RunReportSchema.safeParse({ ...VALID, safety: safetyMissing });
    expect(parsed.success).toBe(false);
  });
});
