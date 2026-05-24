import * as fs from "node:fs";
import * as path from "node:path";

import { parseFrontMatter } from "../fs/front-matter.js";
import type { AgentRole } from "../agents/parse-output.js";
import type { PacketCommon, RunPacketSet } from "./packets.js";

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

function selectPacket(role: AgentRole, packets: RunPacketSet): PacketCommon {
  switch (role) {
    case "engineer":
      return packets.engineer;
    case "semantic-verifier":
      return packets.semantic_verifier;
    case "scope-verifier":
      return packets.scope_verifier;
    case "pm":
      return packets.pm;
  }
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

function renderPacketContext(common: PacketCommon, task: string): string {
  return [
    "## Dispatch packet (pinned — obey exactly)",
    `- repo_root: ${common.repo_root}`,
    `- required_cwd: ${common.required_cwd}`,
    "- cwd discipline:",
    ...common.cwd_discipline.map((line) => `  - ${line}`),
    `- branch: ${common.branch}`,
    `- ticket: ${common.ticket}`,
    `- allowed_paths: ${JSON.stringify(common.allowed_paths)}`,
    `- forbidden_paths: ${JSON.stringify(common.forbidden_paths)}`,
    `- protected_paths: ${JSON.stringify(common.protected_paths)}`,
    "",
    "Run all tools from repo_root (cd there first; verify it is the git repo). Do not inspect other directories.",
    "",
    `## Task`,
    task,
  ].join("\n");
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
  const context = renderPacketContext(selectPacket(role, packets), roleTask(role, packets));

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
