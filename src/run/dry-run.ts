import type { Gate } from "../schema/enums.js";
import { escalationReason, isAdequatelyGated } from "../validate/escalation.js";
import { validateContract } from "../validate/validate-contract.js";
import { loadContract, type LoadedContract, type LoadedSprint, type LoadedTicket } from "../validate/load.js";

/**
 * Single source of truth for the gate → human-required rule: every effective gate
 * needs a human review except `none`. The PM must report `human_gate_required` to
 * match this; it is never inferred from the agent narrative.
 */
export function gateRequiresHuman(effectiveGate: Gate): boolean {
  return effectiveGate !== "none";
}

const AGENT_CHAIN = ["engineer", "semantic-verifier", "scope-verifier", "pm"];

export type RunGateDecision = {
  declared: string;
  effective: string;
  humanRequired: boolean;
  reason: string;
};

export type RunDryRunReport = {
  ok: boolean;
  epicPath: string;
  selected?: {
    sprint: string;
    ticket: string;
    title: string;
    kind: string;
    risk: string;
    change_class: string;
    blast_radius: string;
  };
  dependencyReasoning: string[];
  allowedPaths: string[];
  forbiddenPaths: string[];
  verifyCommands: string[];
  gate: RunGateDecision;
  branch: string;
  agents: string[];
  blockedReasons: string[];
};

/** Selection logic over a (presumed valid) loaded contract. Pure: reads nothing, writes nothing. */
export function planRun(contract: LoadedContract): RunDryRunReport {
  const statusById = new Map<string, string>();
  for (const sprint of contract.sprints) {
    for (const entry of sprint.manifest.tickets) statusById.set(entry.id, entry.status);
  }

  const blockedReasons: string[] = [];
  for (const sprint of contract.sprints) {
    for (const entry of sprint.manifest.tickets) {
      if (entry.status !== "pending") continue;

      const unmet = entry.depends_on.filter((dep) => statusById.get(dep) !== "merged");
      if (unmet.length > 0) {
        blockedReasons.push(`${entry.id} blocked by: ${unmet.map((dep) => `${dep} (${statusById.get(dep) ?? "missing"})`).join(", ")}`);
        continue;
      }

      const ticket = sprint.tickets.find((candidate) => candidate.frontMatter.id === entry.id);
      if (ticket === undefined) {
        blockedReasons.push(`${entry.id}: no loaded ticket file`);
        continue;
      }
      return selectedReport(contract, sprint, ticket, entry.depends_on, statusById);
    }
  }

  if (blockedReasons.length === 0) blockedReasons.push("no pending tickets are ready to run");
  return blockedReport(contract.epicPath, blockedReasons);
}

/** Full dry-run from a contract path: validate first, then select. Read-only. */
export function runDryRun(epicPath: string): RunDryRunReport {
  const validation = validateContract(epicPath);
  if (!validation.ok) {
    const reasons = validation.findings
      .filter((finding) => finding.severity === "error")
      .map((finding) => `${finding.code}: ${finding.message}`);
    return blockedReport(epicPath, reasons.length > 0 ? reasons : ["contract validation failed"]);
  }

  const { contract } = loadContract(epicPath);
  if (contract === undefined) return blockedReport(epicPath, ["contract could not be loaded"]);
  return planRun(contract);
}

function effectiveGate(ticket: LoadedTicket): RunGateDecision {
  const declared = ticket.frontMatter.gate;
  const reason = escalationReason(ticket);

  if (reason !== undefined && !isAdequatelyGated(ticket)) {
    return { declared, effective: "manual", humanRequired: true, reason: `auto-escalated to manual (${reason})` };
  }

  const note =
    reason === undefined
      ? "no escalation"
      : ticket.frontMatter.gate_override
        ? "escalation overridden by gate_override"
        : `escalation already satisfied (${reason})`;
  return { declared, effective: declared, humanRequired: gateRequiresHuman(declared), reason: note };
}

function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "ticket" : slug;
}

function selectedReport(
  contract: LoadedContract,
  sprint: LoadedSprint,
  ticket: LoadedTicket,
  dependsOn: readonly string[],
  statusById: Map<string, string>,
): RunDryRunReport {
  const fm = ticket.frontMatter;
  const dependencyReasoning =
    dependsOn.length === 0
      ? ["no dependencies"]
      : dependsOn.map((dep) => {
          const status = statusById.get(dep);
          const verdict = status === "merged" ? "satisfied" : status === undefined ? "missing (validation should have caught this)" : "blocking";
          return `${dep} ${status ?? "missing"}: ${verdict}`;
        });

  return {
    ok: true,
    epicPath: contract.epicPath,
    selected: {
      sprint: sprint.id,
      ticket: fm.id,
      title: fm.title,
      kind: fm.kind,
      risk: fm.risk,
      change_class: fm.change_class,
      blast_radius: fm.blast_radius,
    },
    dependencyReasoning,
    allowedPaths: fm.allowed_paths,
    forbiddenPaths: fm.forbidden_paths,
    verifyCommands: fm.verify_commands,
    gate: effectiveGate(ticket),
    branch: `forge/${contract.epic.id}/${fm.id}-${slugifyTitle(fm.title)}`,
    agents: [...AGENT_CHAIN],
    blockedReasons: [],
  };
}

function blockedReport(epicPath: string, blockedReasons: string[]): RunDryRunReport {
  return {
    ok: false,
    epicPath,
    dependencyReasoning: [],
    allowedPaths: [],
    forbiddenPaths: [],
    verifyCommands: [],
    gate: { declared: "none", effective: "none", humanRequired: false, reason: "no ticket selected" },
    branch: "",
    agents: [],
    blockedReasons,
  };
}
