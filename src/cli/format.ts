import type { ValidationFinding, ValidationReport } from "../validate/findings.js";
import type { LoadedContract } from "../validate/load.js";

function countSeverities(findings: ValidationFinding[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const finding of findings) {
    if (finding.severity === "error") errors += 1;
    else warnings += 1;
  }
  return { errors, warnings };
}

function findingCountLine(findings: ValidationFinding[]): string {
  const { errors, warnings } = countSeverities(findings);
  return `${findings.length} findings (${errors} errors, ${warnings} warnings)`;
}

function locationSuffix(finding: ValidationFinding): string {
  const parts: string[] = [];
  if (finding.file !== undefined) parts.push(finding.file);
  if (finding.sprint !== undefined) parts.push(`sprint=${finding.sprint}`);
  if (finding.ticket !== undefined) parts.push(`ticket=${finding.ticket}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function formatFinding(finding: ValidationFinding): string {
  return `  [${finding.severity}] ${finding.code}  ${finding.message}${locationSuffix(finding)}`;
}

export function formatReportHuman(report: ValidationReport): string {
  const lines = [
    `Forge validate: ${report.epicPath}`,
    `Result: ${report.ok ? "OK" : "FAILED"}`,
    findingCountLine(report.findings),
    ...report.findings.map(formatFinding),
  ];
  return lines.join("\n");
}

export function formatStatusHuman(contract: LoadedContract, findings: ValidationFinding[]): string {
  const sprintIds = contract.sprints.map((sprint) => sprint.id);
  const lines = [
    `Forge status: ${contract.epicPath}`,
    `Epic: ${contract.epic.id}`,
    `Sprints (${contract.sprints.length}): ${sprintIds.join(", ")}`,
    ...contract.sprints.map((sprint) => `  ${sprint.id}: ${sprint.tickets.length} tickets`),
    findingCountLine(findings),
  ];
  return lines.join("\n");
}
