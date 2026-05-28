import * as fs from "node:fs";
import * as path from "node:path";

import { parseFrontMatter } from "../fs/front-matter.js";
import { parseAgentOutput, type AgentRole } from "../agents/parse-output.js";
import type { EngineerOutput, ScopeVerifierOutput, SemanticVerifierOutput } from "../agents/schemas.js";
import {
  OrchestratorConfirmedFactsSchema,
  type OrchestratorConfirmedFacts,
  type PacketCommon,
  type RunPacketSet,
} from "./packets.js";

export type DispatchMode = "registered" | "injected-charter";

export type AgentDispatch = {
  role: AgentRole;
  subagent_type: string;
  mode: DispatchMode;
  prompt: string;
};

export type BuildAgentDispatchOptions = {
  /** True if the runtime exposes registered `forge-<role>` subagent types. */
  registeredAvailable: boolean;
  /** Directory holding the tracked charter files (`forge-<role>.md`). */
  agentsDir: string;
};

/** Reads the tracked charter file's prose body verbatim (frontmatter stripped). Throws if missing. */
export function loadCharterBody(agentsDir: string, role: AgentRole): string {
  const file = path.join(agentsDir, `forge-${role}.md`);
  const text = fs.readFileSync(file, "utf8"); // throws ENOENT if missing — we never improvise a charter
  const parsed = parseFrontMatter(text);
  return (parsed.ok ? parsed.body : text).trim();
}

function renderCommon(common: PacketCommon): string[] {
  return [
    "## Dispatch packet (pinned — obey exactly)",
    `- repo_root: ${common.repo_root}`,
    `- required_cwd: ${common.required_cwd}`,
    "- cwd discipline:",
    ...common.cwd_discipline.map((line) => `  - ${line}`),
    `- epic_path: ${common.epic_path}`,
    `- branch: ${common.branch}`,
    `- ticket: ${common.ticket}`,
    `- allowed_paths: ${JSON.stringify(common.allowed_paths)}`,
    `- forbidden_paths: ${JSON.stringify(common.forbidden_paths)}`,
    `- protected_paths: ${JSON.stringify(common.protected_paths)}`,
    "",
    "Run all tools from repo_root (cd there first; verify it is the git repo). Do not inspect other directories.",
  ];
}

function roleTask(role: AgentRole, packets: RunPacketSet): string {
  switch (role) {
    case "engineer":
      return `Implement ticket ${packets.engineer.ticket} ("${packets.engineer.ticket_title}", kind ${packets.engineer.ticket_kind}). Edit ONLY within allowed_paths; run the verify commands; emit the engineer output YAML.`;
    case "semantic-verifier":
      return "Independently verify each acceptance criterion against the repo (cite evidence; re-run the verify commands). Emit the semantic-verifier output YAML.";
    case "scope-verifier":
      return "Confirm the diff touches only allowed_paths and no forbidden/protected paths (run git yourself). Emit the scope-verifier output YAML.";
    case "pm":
      return "Decide PASS / CORRECT / ESCALATE from the validated inputs; spot-check only within repo_root. Emit the pm output YAML.";
  }
}

function renderContext(role: AgentRole, packets: RunPacketSet): string {
  switch (role) {
    case "engineer": {
      const p = packets.engineer;
      return [
        ...renderCommon(p),
        `- ticket_file: ${p.ticket_file}`,
        `- verify_commands: ${JSON.stringify(p.verify_commands)}`,
        "",
        "## Ticket (body)",
        p.ticket_body,
        "",
        "## Task",
        roleTask(role, packets),
      ].join("\n");
    }
    case "semantic-verifier": {
      const p = packets.semantic_verifier;
      return [
        ...renderCommon(p),
        `- ticket_file: ${p.ticket_file}`,
        `- verify_commands: ${JSON.stringify(p.verify_commands)}`,
        "",
        "## Acceptance Criteria (verify each against the repo)",
        p.acceptance,
        "",
        "## Task",
        roleTask(role, packets),
      ].join("\n");
    }
    case "scope-verifier":
      return [...renderCommon(packets.scope_verifier), "", "## Task", roleTask(role, packets)].join("\n");
    case "pm": {
      const p = packets.pm;
      const i = p.inputs;
      const lines = [...renderCommon(p)];
      if (i.assigned_decision_id !== null) {
        lines.push("", ...renderAssignedDecisionId(i.assigned_decision_id));
      }
      if (
        i.engineer_output !== null &&
        i.semantic_verifier_output !== null &&
        i.scope_verifier_output !== null &&
        i.orchestrator_confirmed_facts !== null
      ) {
        lines.push(
          "",
          ...renderPmInputs(
            i.engineer_output,
            i.semantic_verifier_output,
            i.scope_verifier_output,
            i.orchestrator_confirmed_facts,
            packets.active_run.gate,
            p.known_harness_limitations,
          ),
        );
      }
      return [...lines, "", "## Task", roleTask(role, packets)].join("\n");
    }
  }
}

/**
 * Render the Core-pinned `decision_id` as an authoritative dispatch section.
 *
 * Modeled on the "Effective gate (authoritative …)" section: same authority,
 * same pin-and-echo contract — the PM agent reads this value from the dispatch
 * packet and emits it verbatim, never inventing or renumbering.
 */
function renderAssignedDecisionId(assignedDecisionId: string): string[] {
  return [
    "## Assigned decision_id (authoritative — use verbatim, never invent)",
    `- decision_id: ${assignedDecisionId}`,
  ];
}

/** Render the assembled, Core-validated PM inputs (the original structures, plus confirmed facts). */
function renderPmInputs(
  engineer: EngineerOutput,
  semantic: SemanticVerifierOutput,
  scope: ScopeVerifierOutput,
  facts: OrchestratorConfirmedFacts,
  gate: { declared: string; effective: string; human_required: boolean },
  knownHarnessLimitations: string[],
): string[] {
  const block = (value: unknown): string[] => ["```json", JSON.stringify(value, null, 2), "```"];
  const { parse_validation: pv, final_branch_status: branch } = facts;
  return [
    "## Inputs (each validated by Forge Core via parse-agent — the original validated structures follow)",
    "",
    "### Engineer output (validated)",
    ...block(engineer),
    "",
    "### Semantic-verifier output (validated)",
    ...block(semantic),
    "",
    "### Scope-verifier output (validated)",
    ...block(scope),
    "",
    "## Orchestrator-confirmed facts (ground truth, gathered in repo_root — never an agent's claim)",
    `- parse_validation: engineer=${pv.engineer}, semantic_verifier=${pv.semantic_verifier}, scope_verifier=${pv.scope_verifier}`,
    "- verify_command_results:",
    ...facts.verify_command_results.map((r) => `  - ${r.cmd} => ${r.result}`),
    "- final_changed_files:",
    ...facts.final_changed_files.map((f) => `  - ${f}`),
    `- final_branch_status: branch=${branch.branch}, ahead_of_base=${branch.ahead_of_base}, committed=${branch.committed}`,
    "",
    "## Effective gate (authoritative — Core-derived; set human_gate_required to match, never infer it)",
    `- declared: ${gate.declared} | effective: ${gate.effective} | human_gate_required: ${gate.human_required}`,
    "",
    "## Known harness limitations",
    ...knownHarnessLimitations.map((l) => `- ${l}`),
  ];
}

/**
 * Build the deterministic dispatch for one agent role from the generated packet.
 * Preferred path: the registered `forge-<role>` subagent (its charter is the system prompt).
 * Fallback: a general-purpose agent with the tracked charter body injected verbatim. Either way the
 * prompt pins repo_root and the cwd-discipline statements; nothing is improvised.
 */
export function buildAgentDispatch(
  role: AgentRole,
  packets: RunPacketSet,
  options: BuildAgentDispatchOptions,
): AgentDispatch {
  const context = renderContext(role, packets);

  if (options.registeredAvailable) {
    return { role, subagent_type: `forge-${role}`, mode: "registered", prompt: context };
  }

  const charter = loadCharterBody(options.agentsDir, role);
  return {
    role,
    subagent_type: "general-purpose",
    mode: "injected-charter",
    prompt: `You are acting as the following Forge agent (charter, obey strictly):\n\n${charter}\n\n${context}`,
  };
}

export type PmRawInputs = {
  /** Raw engineer output (YAML, as the agent emitted it). */
  engineer: string;
  /** Raw semantic-verifier output (YAML). */
  semantic: string;
  /** Raw scope-verifier output (YAML). */
  scope: string;
  /** Raw orchestrator-confirmed facts (JSON). */
  facts: string;
  /**
   * The Core-pinned monotonic decision id (e.g. `D-001`) the orchestrator
   * computed from `$EPIC/.forge/decisions-ledger.json` before dispatching the
   * PM. Required: `buildPmDispatch` fails closed if absent or malformed.
   */
  assignedDecisionId: string;
};

const ASSIGNED_DECISION_ID_PATTERN = /^D-\d+$/;

export type BuildPmDispatchResult =
  | { ok: true; dispatch: AgentDispatch }
  | {
      ok: false;
      code: "AGENT_OUTPUT_INVALID" | "FACTS_INVALID" | "ASSIGNED_DECISION_ID_REQUIRED";
      source: AgentRole | "facts" | "assigned_decision_id";
      errors: string[];
    };

/**
 * Deterministically assemble the PM dispatch from the upstream agent outputs and the
 * orchestrator's confirmed facts — the one judgment-path step that was previously hand-built.
 * Each agent output is re-validated with the existing agent-output validator and the facts
 * with their schema; any invalid input is rejected (never summarized or repaired). On success
 * the validated structures are embedded in the PM prompt verbatim. Pure: writes nothing and
 * does not mutate the input packet skeleton.
 */
export function buildPmDispatch(
  packets: RunPacketSet,
  raw: PmRawInputs,
  options: BuildAgentDispatchOptions,
): BuildPmDispatchResult {
  if (typeof raw.assignedDecisionId !== "string" || !ASSIGNED_DECISION_ID_PATTERN.test(raw.assignedDecisionId)) {
    return {
      ok: false,
      code: "ASSIGNED_DECISION_ID_REQUIRED",
      source: "assigned_decision_id",
      errors: ["assignedDecisionId must be a Core-pinned id matching D-<digits> (e.g. D-001)"],
    };
  }

  const engineer = parseAgentOutput("engineer", raw.engineer);
  if (!engineer.ok) return { ok: false, code: "AGENT_OUTPUT_INVALID", source: "engineer", errors: engineer.errors };

  const semantic = parseAgentOutput("semantic-verifier", raw.semantic);
  if (!semantic.ok) return { ok: false, code: "AGENT_OUTPUT_INVALID", source: "semantic-verifier", errors: semantic.errors };

  const scope = parseAgentOutput("scope-verifier", raw.scope);
  if (!scope.ok) return { ok: false, code: "AGENT_OUTPUT_INVALID", source: "scope-verifier", errors: scope.errors };

  let factsJson: unknown;
  try {
    factsJson = JSON.parse(raw.facts);
  } catch (thrown) {
    return { ok: false, code: "FACTS_INVALID", source: "facts", errors: [`malformed JSON: ${thrown instanceof Error ? thrown.message : String(thrown)}`] };
  }
  const facts = OrchestratorConfirmedFactsSchema.safeParse(factsJson);
  if (!facts.success) {
    const errors = facts.error.issues.map((issue) => `${issue.path.join(".")}${issue.path.length > 0 ? ": " : ""}${issue.message}`);
    return { ok: false, code: "FACTS_INVALID", source: "facts", errors };
  }

  const filled: RunPacketSet = {
    ...packets,
    pm: {
      ...packets.pm,
      inputs: {
        engineer_output: engineer.data,
        semantic_verifier_output: semantic.data,
        scope_verifier_output: scope.data,
        orchestrator_confirmed_facts: facts.data,
        assigned_decision_id: raw.assignedDecisionId,
      },
    },
  };
  return { ok: true, dispatch: buildAgentDispatch("pm", filled, options) };
}
