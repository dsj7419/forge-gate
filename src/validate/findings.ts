export type ValidationSeverity = "error" | "warning";

export type ValidationFinding = {
  code: string;
  severity: ValidationSeverity;
  message: string;
  file?: string;
  line?: number;
  ticket?: string;
};

export type ValidationReport = {
  ok: boolean;
  epicPath: string;
  findings: ValidationFinding[];
};

/** Where a finding points. All fields optional; absent fields are omitted, never set to undefined. */
export type FindingLocation = {
  file?: string;
  line?: number;
  ticket?: string;
};

/**
 * The canonical, stable finding codes. Centralized so they never drift and
 * cannot be mistyped — the CLI, JSON report, and Claude wrapper all key off these.
 */
export const Code = {
  EPIC_FILE_MISSING: "EPIC_FILE_MISSING",
  EPIC_SCHEMA_INVALID: "EPIC_SCHEMA_INVALID",
  MANIFEST_FILE_MISSING: "MANIFEST_FILE_MISSING",
  MANIFEST_SCHEMA_INVALID: "MANIFEST_SCHEMA_INVALID",
  TICKET_FRONT_MATTER_INVALID: "TICKET_FRONT_MATTER_INVALID",
  TICKET_SCHEMA_INVALID: "TICKET_SCHEMA_INVALID",
  DUPLICATE_TICKET_ID: "DUPLICATE_TICKET_ID",
  DEPENDENCY_MISSING: "DEPENDENCY_MISSING",
  BLOCK_TARGET_MISSING: "BLOCK_TARGET_MISSING",
  DEPENDENCY_CYCLE: "DEPENDENCY_CYCLE",
  MANIFEST_TICKET_STATUS_MISMATCH: "MANIFEST_TICKET_STATUS_MISMATCH",
  MANIFEST_TICKET_KIND_MISMATCH: "MANIFEST_TICKET_KIND_MISMATCH",
  PATH_GLOB_OVERLAP: "PATH_GLOB_OVERLAP",
  ACCEPTANCE_CRITERIA_MISSING: "ACCEPTANCE_CRITERIA_MISSING",
  VERIFY_COMMANDS_REQUIRED: "VERIFY_COMMANDS_REQUIRED",
  GATE_POLICY_AUTO_AUTO: "GATE_POLICY_AUTO_AUTO",
  AUTO_ESCALATION_REQUIRED: "AUTO_ESCALATION_REQUIRED",
} as const;

export type ValidationCode = (typeof Code)[keyof typeof Code];

function makeFinding(
  severity: ValidationSeverity,
  code: string,
  message: string,
  location: FindingLocation = {},
): ValidationFinding {
  return { code, severity, message, ...location };
}

export function error(code: string, message: string, location?: FindingLocation): ValidationFinding {
  return makeFinding("error", code, message, location);
}

export function warning(code: string, message: string, location?: FindingLocation): ValidationFinding {
  return makeFinding("warning", code, message, location);
}

/** A report is `ok` only when it contains no error-severity findings. */
export function buildReport(epicPath: string, findings: ValidationFinding[]): ValidationReport {
  return { ok: !findings.some((finding) => finding.severity === "error"), epicPath, findings };
}
