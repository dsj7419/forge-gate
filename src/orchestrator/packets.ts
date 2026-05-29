import * as path from "node:path";

import { z } from "zod";

import type { EngineerOutput, ScopeVerifierOutput, SemanticVerifierOutput } from "../agents/schemas.js";
import { loadContract } from "../validate/load.js";
import { runDryRun } from "../run/dry-run.js";

const CWD_DISCIPLINE = [
  "All repository inspection must happen under repo_root.",
  "If a tool starts elsewhere, cd to repo_root first.",
  "Evidence gathered outside repo_root is invalid evidence.",
  "Do not inspect sibling/default directories.",
];

const PROTECTED_PATHS = [
  "docs/governance/**",
  "**/JOURNAL.md",
  "**/DECISIONS.md",
  "**/manifest.yaml",
  "**/epic.yaml",
];

const GOVERNANCE_DOCS = [
  "CLAUDE.md",
  "docs/governance/ENGINEERING-STANDARDS.md",
  "docs/governance/DEFINITION-OF-READY.md",
  "docs/governance/DEFINITION-OF-DONE.md",
  "docs/governance/SECURITY-STANDARDS.md",
  "docs/governance/TESTING-STANDARDS.md",
  "docs/governance/AGENT-WORKING-AGREEMENT.md",
];

const KNOWN_HARNESS_LIMITATIONS = [
  "Registered Forge subagent types may be unavailable in some harnesses; the orchestrator must dispatch the registered charter if present, else inject the charter text into a generic agent deterministically.",
  "Agents run with the harness session cwd, which may differ from repo_root; every packet pins repo_root and requires cd-ing there first.",
];

export type PacketCommon = {
  repo_root: string;
  required_cwd: string;
  branch: string;
  epic_path: string;
  sprint: string;
  ticket: string;
  allowed_paths: string[];
  forbidden_paths: string[];
  protected_paths: string[];
  cwd_discipline: string[];
};

export type EngineerPacket = PacketCommon & {
  role: "engineer";
  ticket_title: string;
  ticket_kind: string;
  /** Epic-relative path to the ticket file. */
  ticket_file: string;
  /** Full ticket prose body (Scope, Out of Scope, AI Instructions, Acceptance Criteria, …). */
  ticket_body: string;
  verify_commands: string[];
  governance_docs: string[];
  prior_corrections: string[];
  output_schema: "engineer";
};

export type SemanticVerifierPacket = PacketCommon & {
  role: "semantic-verifier";
  ticket_file: string;
  /** The ticket's Acceptance Criteria section text. */
  acceptance: string;
  verify_commands: string[];
  output_schema: "semantic-verifier";
};
export type ScopeVerifierPacket = PacketCommon & { role: "scope-verifier"; output_schema: "scope-verifier" };

/**
 * Ground-truth facts the orchestrator confirms itself (never trusting an agent's claim):
 * which outputs passed validation, the real verify-command results, the actual changed
 * files, and the branch/ahead state. Read from a JSON file at PM-dispatch time, so it is a
 * trust boundary — validated with this schema before it can reach the PM prompt.
 */
export const OrchestratorConfirmedFactsSchema = z
  .object({
    parse_validation: z
      .object({
        engineer: z.boolean(),
        semantic_verifier: z.boolean(),
        scope_verifier: z.boolean(),
        // `pm: true` is recorded by the orchestrator only after `parse-agent pm`
        // returns ok:true AND the `--expected-decision-id` cross-check succeeds
        // (i.e. step 9(e) exits 0). The run-report assembler consumes this flag
        // verbatim — it never assumes PM validated successfully.
        pm: z.boolean(),
      })
      .strict(),
    verify_command_results: z.array(
      z.object({ cmd: z.string(), result: z.enum(["pass", "fail"]) }).strict(),
    ),
    final_changed_files: z.array(z.string()),
    final_branch_status: z
      .object({ branch: z.string(), ahead_of_base: z.number().int().nonnegative(), committed: z.boolean() })
      .strict(),
  })
  .strict();

export type OrchestratorConfirmedFacts = z.infer<typeof OrchestratorConfirmedFactsSchema>;

export type PMPacket = PacketCommon & {
  role: "pm";
  output_schema: "pm";
  /** Filled by the orchestrator at dispatch time — null in the generated skeleton. */
  inputs: {
    engineer_output: EngineerOutput | null;
    semantic_verifier_output: SemanticVerifierOutput | null;
    scope_verifier_output: ScopeVerifierOutput | null;
    orchestrator_confirmed_facts: OrchestratorConfirmedFacts | null;
    /**
     * The Core-pinned, monotonic PM decision id (e.g. `D-001`). `null` in the
     * skeleton from `generateRunPackets`; filled at dispatch time by
     * `buildPmDispatch` from the `--assigned-decision-id` flag. The PM agent
     * MUST echo this value verbatim — it never invents one.
     */
    assigned_decision_id: string | null;
  };
  known_harness_limitations: string[];
};

export type ActiveRun = {
  repo_root: string;
  epic_path: string;
  sprint: string;
  ticket: string;
  branch: string;
  allowed_paths: string[];
  forbidden_paths: string[];
  protected_paths: string[];
  gate: { declared: string; effective: string; human_required: boolean };
};

export type RunPacketSet = {
  active_run: ActiveRun;
  engineer: EngineerPacket;
  semantic_verifier: SemanticVerifierPacket;
  scope_verifier: ScopeVerifierPacket;
  pm: PMPacket;
};

export type GenerateRunPacketsResult = { ok: true; packets: RunPacketSet } | { ok: false; blockedReasons: string[] };

/**
 * Produce the deterministic one-ticket orchestration packet set from a valid epic.
 * Reuses the Core run planner (validate → select) for the decision; pure and
 * read-only (writes nothing). Fails if the dry-run is blocked (no ready ticket
 * or the contract does not validate). Every packet pins an absolute repo_root and
 * the cwd-discipline statements so agents cannot gather wrong-cwd evidence.
 */
export function generateRunPackets(epicPath: string, repoRoot: string): GenerateRunPacketsResult {
  const plan = runDryRun(epicPath);
  if (!plan.ok || plan.selected === undefined) {
    return { ok: false, blockedReasons: plan.blockedReasons.length > 0 ? plan.blockedReasons : ["no ready ticket selected"] };
  }

  const selected = plan.selected;
  const loaded = loadContract(epicPath);
  const sprint = loaded.contract?.sprints.find((entry) => entry.id === selected.sprint);
  const ticket = sprint?.tickets.find((entry) => entry.frontMatter.id === selected.ticket);
  if (ticket === undefined) {
    return { ok: false, blockedReasons: [`selected ticket ${selected.ticket} could not be loaded for packet content`] };
  }
  const acceptance = extractSection(ticket.body, /^#{2,}\s+acceptance(\s+criteria)?\s*$/i);

  const root = path.resolve(repoRoot);
  const common: PacketCommon = {
    repo_root: root,
    required_cwd: root,
    branch: plan.branch,
    epic_path: epicPath,
    sprint: selected.sprint,
    ticket: selected.ticket,
    allowed_paths: plan.allowedPaths,
    forbidden_paths: plan.forbiddenPaths,
    protected_paths: [...PROTECTED_PATHS],
    cwd_discipline: [...CWD_DISCIPLINE],
  };

  const packets: RunPacketSet = {
    active_run: {
      repo_root: root,
      epic_path: epicPath,
      sprint: selected.sprint,
      ticket: selected.ticket,
      branch: plan.branch,
      allowed_paths: plan.allowedPaths,
      forbidden_paths: plan.forbiddenPaths,
      protected_paths: [...PROTECTED_PATHS],
      gate: { declared: plan.gate.declared, effective: plan.gate.effective, human_required: plan.gate.humanRequired },
    },
    engineer: {
      ...common,
      role: "engineer",
      ticket_title: selected.title,
      ticket_kind: selected.kind,
      ticket_file: ticket.file,
      ticket_body: ticket.body,
      verify_commands: ticket.frontMatter.verify_commands,
      governance_docs: [...GOVERNANCE_DOCS],
      prior_corrections: [],
      output_schema: "engineer",
    },
    semantic_verifier: {
      ...common,
      role: "semantic-verifier",
      ticket_file: ticket.file,
      acceptance,
      verify_commands: ticket.frontMatter.verify_commands,
      output_schema: "semantic-verifier",
    },
    scope_verifier: { ...common, role: "scope-verifier", output_schema: "scope-verifier" },
    pm: {
      ...common,
      role: "pm",
      output_schema: "pm",
      inputs: {
        engineer_output: null,
        semantic_verifier_output: null,
        scope_verifier_output: null,
        orchestrator_confirmed_facts: null,
        assigned_decision_id: null,
      },
      known_harness_limitations: [...KNOWN_HARNESS_LIMITATIONS],
    },
  };

  return { ok: true, packets };
}

/** Extract a markdown section (heading + its content up to the next heading). */
function extractSection(body: string, headingPattern: RegExp): string {
  const lines = body.split(/\r\n?|\n/);
  const start = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (start === -1) return "";
  const section: string[] = [];
  const heading = lines[start];
  if (heading !== undefined) section.push(heading);
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^#{1,6}\s/.test(line.trim())) break;
    section.push(line);
  }
  return section.join("\n").trim();
}
