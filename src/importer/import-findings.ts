export type ImportSeverity = "error" | "warning" | "info";

/** Stable, centralized import finding codes (no ad-hoc strings). */
export const ImportCode = {
  IMPORT_SOURCE_MISSING: "IMPORT_SOURCE_MISSING",
  IMPORT_OUTPUT_EXISTS: "IMPORT_OUTPUT_EXISTS",
  IMPORT_AMBIGUOUS_TICKET_ID: "IMPORT_AMBIGUOUS_TICKET_ID",
  IMPORT_AMBIGUOUS_TICKET_KIND: "IMPORT_AMBIGUOUS_TICKET_KIND",
  IMPORT_AMBIGUOUS_RISK: "IMPORT_AMBIGUOUS_RISK",
  IMPORT_AMBIGUOUS_CHANGE_CLASS: "IMPORT_AMBIGUOUS_CHANGE_CLASS",
  IMPORT_AMBIGUOUS_BLAST_RADIUS: "IMPORT_AMBIGUOUS_BLAST_RADIUS",
  IMPORT_MISSING_ACCEPTANCE_CRITERIA: "IMPORT_MISSING_ACCEPTANCE_CRITERIA",
  IMPORT_DECISIONS_MIGRATED: "IMPORT_DECISIONS_MIGRATED",
  IMPORT_PROSE_PRESERVED: "IMPORT_PROSE_PRESERVED",
  IMPORT_SKIPPED_UNKNOWN_FILE: "IMPORT_SKIPPED_UNKNOWN_FILE",
  IMPORT_DRY_RUN_ONLY: "IMPORT_DRY_RUN_ONLY",
} as const;

export type ImportCodeValue = (typeof ImportCode)[keyof typeof ImportCode];

export type ImportLocation = {
  file?: string;
  sourceFile?: string;
  targetFile?: string;
};

export type ImportFinding = {
  code: ImportCodeValue;
  severity: ImportSeverity;
  message: string;
  file?: string;
  sourceFile?: string;
  targetFile?: string;
};

export type ImportFileAction = "create" | "skip" | "would_create";

export type ImportPlanFile = {
  targetFile: string;
  action: ImportFileAction;
  contentPreview?: string;
  sourceFiles: string[];
};

export type ImportPlan = {
  ok: boolean;
  sourcePath: string;
  outPath: string;
  dryRun: boolean;
  files: ImportPlanFile[];
  findings: ImportFinding[];
};

export function importFinding(
  severity: ImportSeverity,
  code: ImportCodeValue,
  message: string,
  location: ImportLocation = {},
): ImportFinding {
  return { code, severity, message, ...location };
}

/** A plan is `ok` only when it contains no error-severity findings. */
export function importPlanOk(findings: ImportFinding[]): boolean {
  return !findings.some((finding) => finding.severity === "error");
}
