import type { GatePolicy } from "../schema/gate-policy.js";
import { escalationReason, isAdequatelyGated } from "./escalation.js";
import { Code, error, type ValidationFinding } from "./findings.js";
import type { LoadedContract } from "./load.js";

/**
 * Execution-readiness stage: pure checks that a contract is safe to run.
 * No filesystem, no writes, no mutation. Operates on the loaded model.
 */
export function validateReadiness(contract: LoadedContract): ValidationFinding[] {
  return [
    ...pathOverlaps(contract),
    ...acceptanceCriteriaMissing(contract),
    ...verifyCommandsRequiredByKind(contract),
    ...gatePolicyAutoAuto(contract),
    ...autoEscalationRequired(contract),
  ];
}

// --- 1. Path overlap --------------------------------------------------------
//
// Pragmatic, deterministic overlap detection (not a full glob-intersection
// solver). It compares the literal (pre-wildcard) prefixes of each pattern and
// reports an overlap when one prefix is a path-ancestor of (or equal to) the
// other. This catches the cases that matter in practice — exact duplicates and
// a broad allow covering a narrower forbid (or vice versa).
//
// Known limit: patterns that begin with a wildcard (e.g. "**/x") have an empty
// literal prefix and are not analyzed for overlap in v1.

function literalPrefix(pattern: string): string {
  const wildcardIndex = pattern.search(/[*?{}[\]()!]/);
  const prefix = wildcardIndex === -1 ? pattern : pattern.slice(0, wildcardIndex);
  return prefix.replace(/\/+$/, "");
}

function isPathAncestorOrEqual(prefix: string, full: string): boolean {
  if (prefix === "") return false;
  return prefix === full || full.startsWith(`${prefix}/`);
}

function pathsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  const prefixA = literalPrefix(a);
  const prefixB = literalPrefix(b);
  return isPathAncestorOrEqual(prefixA, prefixB) || isPathAncestorOrEqual(prefixB, prefixA);
}

function pathOverlaps(contract: LoadedContract): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const sprint of contract.sprints) {
    for (const ticket of sprint.tickets) {
      for (const allowed of ticket.frontMatter.allowed_paths) {
        for (const forbidden of ticket.frontMatter.forbidden_paths) {
          if (pathsOverlap(allowed, forbidden)) {
            findings.push(
              error(Code.PATH_GLOB_OVERLAP, `allowed path "${allowed}" overlaps forbidden path "${forbidden}"`, {
                sprint: sprint.id,
                ticket: ticket.frontMatter.id,
                file: ticket.file,
              }),
            );
          }
        }
      }
    }
  }
  return findings;
}

// --- 2. Acceptance criteria -------------------------------------------------

const ACCEPTANCE_HEADING = /^#{2,}\s+acceptance(\s+criteria)?\s*$/i;
const ANY_HEADING = /^#{1,6}\s/;

function hasAcceptanceSection(body: string): boolean {
  const lines = body.split(/\r\n?|\n/);
  const headingIndex = lines.findIndex((line) => ACCEPTANCE_HEADING.test(line.trim()));
  if (headingIndex === -1) return false;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    if (ANY_HEADING.test(line)) break;
    if (line !== "") return true;
  }
  return false;
}

function acceptanceCriteriaMissing(contract: LoadedContract): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const sprint of contract.sprints) {
    for (const ticket of sprint.tickets) {
      if (!hasAcceptanceSection(ticket.body)) {
        findings.push(
          error(Code.ACCEPTANCE_CRITERIA_MISSING, "ticket body has no non-empty Acceptance Criteria section", {
            sprint: sprint.id,
            ticket: ticket.frontMatter.id,
            file: ticket.file,
          }),
        );
      }
    }
  }
  return findings;
}

// --- 3. Verify commands required by kind ------------------------------------

const KINDS_REQUIRING_VERIFY = new Set(["red", "green"]);

function verifyCommandsRequiredByKind(contract: LoadedContract): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const sprint of contract.sprints) {
    for (const ticket of sprint.tickets) {
      if (KINDS_REQUIRING_VERIFY.has(ticket.frontMatter.kind) && ticket.frontMatter.verify_commands.length === 0) {
        findings.push(
          error(Code.VERIFY_COMMANDS_REQUIRED, `a ${ticket.frontMatter.kind} ticket must declare verify_commands`, {
            sprint: sprint.id,
            ticket: ticket.frontMatter.id,
            file: ticket.file,
          }),
        );
      }
    }
  }
  return findings;
}

// --- 4. Gate policy auto/auto ----------------------------------------------

function isAutoAuto(gatePolicy: GatePolicy): boolean {
  return gatePolicy.default_push === "auto" && gatePolicy.default_merge === "auto";
}

function gatePolicyAutoAuto(contract: LoadedContract): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (isAutoAuto(contract.epic.gate_policy)) {
    findings.push(
      error(Code.GATE_POLICY_AUTO_AUTO, "epic gate policy is auto/auto; at least one human gate is required in v1", {
        file: contract.epicFile,
      }),
    );
  }
  for (const sprint of contract.sprints) {
    if (isAutoAuto(sprint.manifest.gate_policy)) {
      findings.push(
        error(Code.GATE_POLICY_AUTO_AUTO, `sprint ${sprint.id} gate policy is auto/auto; a human gate is required in v1`, {
          sprint: sprint.id,
          file: sprint.manifestFile,
        }),
      );
    }
  }
  return findings;
}

// --- 5. Auto-escalation (escalation logic shared with the run planner) ------

function autoEscalationRequired(contract: LoadedContract): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const sprint of contract.sprints) {
    for (const ticket of sprint.tickets) {
      const reason = escalationReason(ticket);
      if (reason && !isAdequatelyGated(ticket)) {
        findings.push(
          error(
            Code.AUTO_ESCALATION_REQUIRED,
            `high-risk ticket must use gate: manual or a recorded gate_override (${reason})`,
            { sprint: sprint.id, ticket: ticket.frontMatter.id, file: ticket.file },
          ),
        );
      }
    }
  }
  return findings;
}
