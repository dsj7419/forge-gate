import type {
  EngineerOutput,
  PMOutput,
  ScopeVerifierOutput,
  SemanticVerifierOutput,
} from "../agents/schemas.js";
import type { ActiveTicket } from "../guard/active-ticket.js";
import type { OrchestratorConfirmedFacts } from "../orchestrator/packets.js";

import {
  RUN_REPORT_COMMAND,
  RUN_REPORT_SCHEMA,
  RunReportSchema,
  type RunReport,
} from "./schema.js";

/**
 * Inputs the assembler consumes — all already validated upstream (Core's
 * `parseAgentOutput` for the four agent outputs, `OrchestratorConfirmedFactsSchema`
 * for facts, `ActiveTicketSchema` for the active-ticket) plus runtime metadata
 * only the orchestrator can supply (checkpoint SHAs, guard, optional materials).
 *
 * The assembler is a pure function; nothing here triggers IO.
 */
export type AssembleInputs = {
  engineer: EngineerOutput;
  semantic: SemanticVerifierOutput;
  scope: ScopeVerifierOutput;
  pm: PMOutput;
  facts: OrchestratorConfirmedFacts;
  activeTicket: ActiveTicket;
  runtime: RuntimeMetadata;
};

export type RuntimeMetadata = {
  /** Terminal result for this run: PASS (commit-gate-ready) or ESCALATE. */
  result: "PASS" | "ESCALATE";
  /** Ticket title (the orchestrator knows it from the validated contract / packet). */
  ticket_title: string;
  /** Core-derived effective gate (mirrors `dispatch.ts` effective-gate). */
  effective_gate: { declared: string; effective: string; human_required: boolean };
  /** Git checkpoint the orchestrator captured before/after the run. */
  checkpoint: { base: string; head: string };
  /** Result of the deterministic path guard (step 7 in the orchestrator). */
  guard: { result: string; exit: number };
  /** Optional commit-gate materials (PASS only — PM-decision-driven, not safety). */
  commit_gate_materials?: {
    proposed_status_transition: string;
    suggested_commit_message: string;
    suggested_commands: string[];
  };
  /** Optional narrative notes (transport noise, bootstrap caveats, follow-ups). Never new top-level fields. */
  notes?: string[];
  /**
   * Optional per-role trust-path provenance — which evidence path produced each
   * agent output. Explicit orchestrator-supplied runtime metadata; NOT derived
   * from the captured outputs and NOT routed through OrchestratorConfirmedFacts.
   * Each role is individually optional.
   */
  agent_output_source?: {
    engineer?: "yaml_text" | "structured_json" | "workflow_core_runner";
    semantic_verifier?: "yaml_text" | "structured_json" | "workflow_core_runner";
    scope_verifier?: "yaml_text" | "structured_json" | "workflow_core_runner";
    pm?: "yaml_text" | "structured_json" | "workflow_core_runner";
  };
};

export type AssembleFailureCode =
  | "HUMAN_GATE_MISMATCH"
  | "RESULT_REQUIRES_GREEN"
  | "RUN_REPORT_INVALID";

export type AssembleResult =
  | { ok: true; report: RunReport }
  | { ok: false; code: AssembleFailureCode; errors: string[] };

/** Canonical relative paths the orchestrator captures each agent's raw output to. */
const AGENT_OUTPUT_FILES = {
  engineer: ".forge/engineer-output.yaml",
  semantic_verifier: ".forge/semantic-verifier-output.yaml",
  scope_verifier: ".forge/scope-verifier-output.yaml",
  pm: ".forge/pm-output.yaml",
} as const;

/**
 * Normalize Windows backslash separators to forward slashes. The path is
 * otherwise left exactly as supplied — this is presentation normalization, not
 * resolution; absolute drive letters stay (`D:\foo` → `D:/foo`).
 */
function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

/**
 * Pure: assemble a typed v1 `RunReport` from the already-validated agent outputs,
 * orchestrator-confirmed facts, active-ticket, and orchestrator-supplied runtime
 * metadata. Does not mutate any input.
 *
 * Cross-checks (each returns a typed failure, never a guess):
 * - `human_gate_required` from the PM output MUST match the Core-derived effective
 *   gate (`HUMAN_GATE_MISMATCH`).
 * - `result: "PASS"` is allowed only when every `parse_validation` flag is true,
 *   both verifiers are `APPROVE`, and PM `decision` is `PASS`
 *   (`RESULT_REQUIRES_GREEN`). `result: "ESCALATE"` accepts any combination —
 *   it is a terminal evidence report.
 *
 * The final report is re-validated against `RunReportSchema`. A failure here
 * surfaces as `RUN_REPORT_INVALID` — a defense against future drift in the
 * assembler itself.
 */
export function assembleRunReport(inputs: AssembleInputs): AssembleResult {
  // `engineer` is intentionally not destructured here: its presence is the
  // upstream gate (a validated EngineerOutput proves parse_validation.engineer
  // is true), but the report does not embed the engineer object verbatim — the
  // raw output is captured separately under `.forge/engineer-output.yaml`.
  const { semantic, scope, pm, facts, activeTicket, runtime } = inputs;

  // Cross-check: PM's human_gate_required must match the Core-derived effective gate.
  if (pm.human_gate_required !== runtime.effective_gate.human_required) {
    return {
      ok: false,
      code: "HUMAN_GATE_MISMATCH",
      errors: [
        `PM emitted human_gate_required=${pm.human_gate_required} but Core-derived effective gate has human_required=${runtime.effective_gate.human_required}`,
      ],
    };
  }

  // Cross-check: PASS requires green across the board. ESCALATE is unrestricted.
  if (runtime.result === "PASS") {
    const greenFailures: string[] = [];
    if (!facts.parse_validation.engineer) greenFailures.push("parse_validation.engineer is false");
    if (!facts.parse_validation.semantic_verifier) greenFailures.push("parse_validation.semantic_verifier is false");
    if (!facts.parse_validation.scope_verifier) greenFailures.push("parse_validation.scope_verifier is false");
    if (!facts.parse_validation.pm) greenFailures.push("parse_validation.pm is false");
    if (semantic.verdict !== "APPROVE") greenFailures.push(`semantic verdict is ${semantic.verdict}, expected APPROVE`);
    if (scope.verdict !== "APPROVE") greenFailures.push(`scope verdict is ${scope.verdict}, expected APPROVE`);
    if (pm.decision !== "PASS") greenFailures.push(`PM decision is ${pm.decision}, expected PASS`);

    if (greenFailures.length > 0) {
      return {
        ok: false,
        code: "RESULT_REQUIRES_GREEN",
        errors: [
          "result: \"PASS\" requires green across all upstream validations and verifiers",
          ...greenFailures,
        ],
      };
    }
  }

  const candidate: RunReport = {
    schema: RUN_REPORT_SCHEMA,
    command: RUN_REPORT_COMMAND,
    result: runtime.result,
    epic_path: normalizePath(activeTicket.epic_path ?? ""),
    target_repo: normalizePath(activeTicket.repo_root),
    ticket: activeTicket.ticket,
    ticket_title: runtime.ticket_title,
    branch: activeTicket.branch ?? facts.final_branch_status.branch,
    decision: pm.decision,
    decision_id: pm.decision_id,
    human_gate_required: pm.human_gate_required,
    gate: {
      declared: runtime.effective_gate.declared,
      effective: runtime.effective_gate.effective,
      human_required: runtime.effective_gate.human_required,
    },
    checkpoint: { base: runtime.checkpoint.base, head: runtime.checkpoint.head },
    parse_validation: {
      engineer: facts.parse_validation.engineer,
      semantic_verifier: facts.parse_validation.semantic_verifier,
      scope_verifier: facts.parse_validation.scope_verifier,
      pm: facts.parse_validation.pm,
    },
    verify_command_results: facts.verify_command_results.map((entry) => ({
      cmd: entry.cmd,
      result: entry.result,
    })),
    guard: { result: runtime.guard.result, exit: runtime.guard.exit },
    verifiers: { semantic: semantic.verdict, scope: scope.verdict },
    final_changed_files: facts.final_changed_files.map(normalizePath),
    final_branch_status: {
      branch: facts.final_branch_status.branch,
      ahead_of_base: facts.final_branch_status.ahead_of_base,
      committed: false,
    },
    agent_outputs: { ...AGENT_OUTPUT_FILES },
    ...(runtime.commit_gate_materials !== undefined
      ? {
          commit_gate_materials: {
            proposed_status_transition: runtime.commit_gate_materials.proposed_status_transition,
            suggested_commit_message: runtime.commit_gate_materials.suggested_commit_message,
            suggested_commands: [...runtime.commit_gate_materials.suggested_commands],
          },
        }
      : {}),
    ...(runtime.agent_output_source !== undefined
      ? { agent_output_source: { ...runtime.agent_output_source } }
      : {}),
    ...(runtime.notes !== undefined && runtime.notes.length > 0
      ? { notes: [...runtime.notes] }
      : {}),
    safety: {
      committed: false,
      pushed: false,
      pr_opened: false,
      merged: false,
      status_write_back: false,
      journal_written: false,
    },
  };

  // Defense in depth: re-validate the assembled report so a future bug in this
  // function cannot silently produce an invalid v1 artifact.
  const parsed = RunReportSchema.safeParse(candidate);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => {
      const at = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${at}${issue.message}`;
    });
    return { ok: false, code: "RUN_REPORT_INVALID", errors };
  }

  // The committed flag is locked to false in v1; if the orchestrator-confirmed
  // facts say otherwise that is a v1 safety violation. Re-checking the *facts*
  // here (not just the report we produced) ensures the schema's safety thesis
  // cannot be circumvented by simply overwriting the field in `candidate`.
  if (facts.final_branch_status.committed) {
    return {
      ok: false,
      code: "RUN_REPORT_INVALID",
      errors: ["facts.final_branch_status.committed is true; v1 disallows committed runs"],
    };
  }

  return { ok: true, report: parsed.data };
}
