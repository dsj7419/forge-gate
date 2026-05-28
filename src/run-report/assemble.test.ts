import { describe, expect, test } from "vitest";

import type {
  EngineerOutput,
  PMOutput,
  ScopeVerifierOutput,
  SemanticVerifierOutput,
} from "../agents/schemas.js";
import type { OrchestratorConfirmedFacts } from "../orchestrator/packets.js";

import { assembleRunReport, type AssembleInputs, type RuntimeMetadata } from "./assemble.js";

const ENGINEER: EngineerOutput = {
  ticket: "T01",
  summary: "add helper",
  files_changed: [{ path: "src/sandbox/add.ts", adds: 3, dels: 0 }],
  tests: { added: 2, changed: 0 },
  commands_run: [{ cmd: "pnpm test", result: "pass" }],
  risks: [],
  deviations: [],
  within_allowed_paths: true,
};

const SEMANTIC: SemanticVerifierOutput = {
  verdict: "APPROVE",
  acceptance_checked: [{ id: 1, status: "met", evidence: "add.ts:1" }],
  findings: [],
  missing_proof: [],
  risk_level: "low",
};

const SCOPE: ScopeVerifierOutput = {
  verdict: "APPROVE",
  changed_files: ["src/sandbox/add.ts"],
  allowed_path_status: "clean",
  forbidden_path_violations: [],
  unexpected_files: [],
  recommendation: "in scope",
};

const PM: PMOutput = {
  decision: "PASS",
  rationale: "everything green",
  instructions: [],
  decision_id: "D-001",
  journal_entry: "T01 PASS — ready_for_pr proposed",
  human_gate_required: true,
};

const FACTS: OrchestratorConfirmedFacts = {
  parse_validation: { engineer: true, semantic_verifier: true, scope_verifier: true },
  verify_command_results: [
    { cmd: "pnpm test", result: "pass" },
    { cmd: "pnpm typecheck", result: "pass" },
  ],
  final_changed_files: ["src/sandbox/add.ts", "src/sandbox/add.test.ts"],
  final_branch_status: {
    branch: "forge/sandbox-epic/T01-add",
    ahead_of_base: 0,
    committed: false,
  },
};

const ACTIVE_TICKET = {
  schema: "forge-active-ticket/v1" as const,
  repo_root: "D:/Projects/forge",
  epic_path: "D:/Projects/forge/docs/epics/example",
  ticket: "T01",
  branch: "forge/sandbox-epic/T01-add",
  allowed_paths: ["src/sandbox/**"],
  forbidden_paths: ["package.json"],
  protected_paths: ["**/manifest.yaml"],
};

const RUNTIME: RuntimeMetadata = {
  result: "PASS",
  ticket_title: "Add helper",
  effective_gate: { declared: "pr", effective: "pr", human_required: true },
  checkpoint: { base: "abc123", head: "abc123" },
  guard: { result: "OK", exit: 0 },
};

function inputs(over: Partial<AssembleInputs> = {}): AssembleInputs {
  return {
    engineer: ENGINEER,
    semantic: SEMANTIC,
    scope: SCOPE,
    pm: PM,
    facts: FACTS,
    activeTicket: ACTIVE_TICKET,
    runtime: RUNTIME,
    ...over,
  };
}

describe("assembleRunReport — happy path", () => {
  test("returns a valid v1 RunReport for a fully-green PASS run", () => {
    const result = assembleRunReport(inputs());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.schema).toBe("forge-run-report/v1");
    expect(result.report.command).toBe("/forge-run-ticket");
    expect(result.report.result).toBe("PASS");
    expect(result.report.decision).toBe("PASS");
    expect(result.report.parse_validation.pm).toBe(true);
    expect(result.report.verifiers.semantic).toBe("APPROVE");
    expect(result.report.verifiers.scope).toBe("APPROVE");
    expect(result.report.safety.committed).toBe(false);
    expect(result.report.safety.journal_written).toBe(false);
  });

  test("preserves decision_id verbatim from the PM output", () => {
    const pm: PMOutput = { ...PM, decision_id: "D-042" };
    const result = assembleRunReport(inputs({ pm }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.decision_id).toBe("D-042");
  });

  test("derives agent_outputs from canonical .forge/<role>-output.yaml names", () => {
    const result = assembleRunReport(inputs());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.agent_outputs).toEqual({
      engineer: ".forge/engineer-output.yaml",
      semantic_verifier: ".forge/semantic-verifier-output.yaml",
      scope_verifier: ".forge/scope-verifier-output.yaml",
      pm: ".forge/pm-output.yaml",
    });
  });
});

describe("assembleRunReport — path normalization", () => {
  test("normalizes backslashes to forward slashes in epic_path, target_repo, and final_changed_files", () => {
    const result = assembleRunReport(
      inputs({
        activeTicket: {
          ...ACTIVE_TICKET,
          repo_root: "D:\\Projects\\forge",
          epic_path: "D:\\Projects\\forge\\docs\\epics\\example",
        },
        facts: {
          ...FACTS,
          final_changed_files: ["src\\sandbox\\add.ts", "src\\sandbox\\add.test.ts"],
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.target_repo).toBe("D:/Projects/forge");
    expect(result.report.epic_path).toBe("D:/Projects/forge/docs/epics/example");
    expect(result.report.final_changed_files).toEqual([
      "src/sandbox/add.ts",
      "src/sandbox/add.test.ts",
    ]);
  });
});

describe("assembleRunReport — human-gate cross-check", () => {
  test("HUMAN_GATE_MISMATCH when the PM's human_gate_required disagrees with the effective gate", () => {
    const pm: PMOutput = { ...PM, human_gate_required: false };
    const result = assembleRunReport(inputs({ pm }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("HUMAN_GATE_MISMATCH");
  });

  test("agrees when both are true (default fixture)", () => {
    const result = assembleRunReport(inputs());
    expect(result.ok).toBe(true);
  });

  test("agrees when both are false", () => {
    const pm: PMOutput = { ...PM, human_gate_required: false };
    const runtime: RuntimeMetadata = {
      ...RUNTIME,
      effective_gate: { declared: "none", effective: "none", human_required: false },
    };
    const result = assembleRunReport(inputs({ pm, runtime }));
    expect(result.ok).toBe(true);
  });
});

describe("assembleRunReport — RESULT_REQUIRES_GREEN when PASS is requested over non-green inputs", () => {
  test("fails when a verifier is REJECT", () => {
    const semantic: SemanticVerifierOutput = { ...SEMANTIC, verdict: "REJECT" };
    const result = assembleRunReport(inputs({ semantic }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("RESULT_REQUIRES_GREEN");
  });

  test("fails when scope verifier is REJECT", () => {
    const scope: ScopeVerifierOutput = { ...SCOPE, verdict: "REJECT" };
    const result = assembleRunReport(inputs({ scope }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("RESULT_REQUIRES_GREEN");
  });

  test("fails when any parse_validation flag is false", () => {
    const facts: OrchestratorConfirmedFacts = {
      ...FACTS,
      parse_validation: { ...FACTS.parse_validation, engineer: false },
    };
    const result = assembleRunReport(inputs({ facts }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("RESULT_REQUIRES_GREEN");
  });

  test("fails when PM decision is CORRECT but result is PASS", () => {
    const pm: PMOutput = {
      ...PM,
      decision: "CORRECT",
      instructions: ["fix the foo"],
    };
    const result = assembleRunReport(inputs({ pm }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("RESULT_REQUIRES_GREEN");
  });
});

describe("assembleRunReport — ESCALATE is accepted with non-green inputs", () => {
  test("ESCALATE accepted when a verifier REJECTed", () => {
    const semantic: SemanticVerifierOutput = { ...SEMANTIC, verdict: "REJECT" };
    const pm: PMOutput = {
      ...PM,
      decision: "ESCALATE",
      rationale: "semantic rejected",
    };
    const runtime: RuntimeMetadata = { ...RUNTIME, result: "ESCALATE" };
    const result = assembleRunReport(inputs({ semantic, pm, runtime }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.result).toBe("ESCALATE");
    expect(result.report.verifiers.semantic).toBe("REJECT");
  });

  test("ESCALATE accepted with verifiers green and PM ESCALATE (terminal evidence)", () => {
    const pm: PMOutput = {
      ...PM,
      decision: "ESCALATE",
      rationale: "human asked to stop",
    };
    const runtime: RuntimeMetadata = { ...RUNTIME, result: "ESCALATE" };
    const result = assembleRunReport(inputs({ pm, runtime }));
    expect(result.ok).toBe(true);
  });
});

describe("assembleRunReport — narrative one-offs land in notes (not new top-level fields)", () => {
  test("optional notes are passed through into the report", () => {
    const runtime: RuntimeMetadata = {
      ...RUNTIME,
      notes: [
        "transport noise observed during PM dispatch but output validated",
        "bootstrap note: this is the first run after the decision-id ledger landed",
      ],
    };
    const result = assembleRunReport(inputs({ runtime }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.notes).toEqual(runtime.notes);
    // and no drift field at the top level
    expect(Object.keys(result.report)).not.toContain("transport_note");
    expect(Object.keys(result.report)).not.toContain("bootstrap_note");
  });
});

describe("assembleRunReport — optional commit_gate_materials", () => {
  test("commit-gate materials propagate when supplied", () => {
    const runtime: RuntimeMetadata = {
      ...RUNTIME,
      commit_gate_materials: {
        proposed_status_transition: "T01: pending -> ready_for_pr (proposed)",
        suggested_commit_message: "feat: add foo",
        suggested_commands: ["git add x", "git commit -m \"feat: add foo\""],
      },
    };
    const result = assembleRunReport(inputs({ runtime }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.commit_gate_materials?.proposed_status_transition).toContain("T01");
  });
});

describe("assembleRunReport — purity", () => {
  test("does not mutate the provided inputs", () => {
    const engineer: EngineerOutput = JSON.parse(JSON.stringify(ENGINEER)) as EngineerOutput;
    const semantic: SemanticVerifierOutput = JSON.parse(JSON.stringify(SEMANTIC)) as SemanticVerifierOutput;
    const scope: ScopeVerifierOutput = JSON.parse(JSON.stringify(SCOPE)) as ScopeVerifierOutput;
    const pm: PMOutput = JSON.parse(JSON.stringify(PM)) as PMOutput;
    const facts: OrchestratorConfirmedFacts = JSON.parse(JSON.stringify(FACTS)) as OrchestratorConfirmedFacts;
    const activeTicket = JSON.parse(JSON.stringify(ACTIVE_TICKET));
    const runtime: RuntimeMetadata = JSON.parse(JSON.stringify(RUNTIME)) as RuntimeMetadata;

    const before = JSON.stringify({ engineer, semantic, scope, pm, facts, activeTicket, runtime });
    assembleRunReport({ engineer, semantic, scope, pm, facts, activeTicket, runtime });
    const after = JSON.stringify({ engineer, semantic, scope, pm, facts, activeTicket, runtime });

    expect(after).toBe(before);
  });
});
