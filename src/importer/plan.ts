import * as path from "node:path";

import { BlastRadiusEnum, ChangeClassEnum, RiskEnum } from "../schema/enums.js";
import {
  ImportCode,
  type ImportCodeValue,
  type ImportFileAction,
  type ImportFinding,
  type ImportPlan,
  type ImportPlanFile,
  importFinding,
  importPlanOk,
} from "./import-findings.js";
import { scanLegacySprint, type ScannedFile } from "./scan.js";

type EnumSchema = { safeParse: (value: unknown) => { success: boolean } };

export type PlanImportOptions = { dryRun: boolean };

/**
 * Produce a structured plan for importing a legacy sprint folder into the
 * canonical Forge contract. Pure planning: reads the source, writes nothing,
 * and flags ambiguity rather than inventing canonical metadata.
 */
export function planImport(sourcePath: string, outPath: string, options: PlanImportOptions): ImportPlan {
  const scan = scanLegacySprint(sourcePath);
  const findings: ImportFinding[] = [];
  const files: ImportPlanFile[] = [];

  if (!scan.sourceExists) {
    findings.push(
      importFinding("error", ImportCode.IMPORT_SOURCE_MISSING, `legacy source folder not found: ${sourcePath}`, {
        sourceFile: sourcePath,
      }),
    );
    return { ok: false, sourcePath, outPath, dryRun: options.dryRun, files, findings };
  }

  const action: ImportFileAction = options.dryRun ? "would_create" : "create";
  const epicId = path.basename(outPath) || "imported-epic";
  const sprintId = deriveSprintId(sourcePath);

  files.push({ targetFile: "epic.yaml", action, sourceFiles: [], contentPreview: `id: ${epicId}\nsprints: [${sprintId}]` });
  files.push({ targetFile: "EPIC.md", action, sourceFiles: [] });

  const overview = scan.files.find((file) => file.kind === "overview");
  files.push({ targetFile: `${sprintId}/SPRINT.md`, action, sourceFiles: overview ? [overview.file] : [] });
  if (overview) {
    findings.push(
      importFinding("info", ImportCode.IMPORT_PROSE_PRESERVED, `sprint overview prose preserved from ${overview.file}`, {
        sourceFile: overview.file,
        targetFile: `${sprintId}/SPRINT.md`,
      }),
    );
  }

  files.push({ targetFile: `${sprintId}/manifest.yaml`, action, sourceFiles: [] });
  files.push({ targetFile: `${sprintId}/JOURNAL.md`, action, sourceFiles: [] });

  const decisions = scan.files.find((file) => file.kind === "decisions");
  if (decisions) {
    files.push({ targetFile: "DECISIONS.md", action, sourceFiles: [decisions.file] });
    findings.push(
      importFinding("info", ImportCode.IMPORT_DECISIONS_MIGRATED, `decisions migrated from ${decisions.file}`, {
        sourceFile: decisions.file,
        targetFile: "DECISIONS.md",
      }),
    );
  }

  for (const ticket of scan.files.filter((file) => file.kind === "ticket")) {
    const planned = planTicket(ticket, sprintId, action);
    files.push(planned.file);
    findings.push(...planned.findings);
  }

  for (const unknown of scan.files.filter((file) => file.kind === "unknown")) {
    findings.push(
      importFinding("warning", ImportCode.IMPORT_SKIPPED_UNKNOWN_FILE, `unrecognized legacy file not imported: ${unknown.file}`, {
        sourceFile: unknown.file,
      }),
    );
  }

  if (options.dryRun) {
    findings.push(importFinding("info", ImportCode.IMPORT_DRY_RUN_ONLY, "dry run: no files were written"));
  }

  return { ok: importPlanOk(findings), sourcePath, outPath, dryRun: options.dryRun, files, findings };
}

function deriveSprintId(sourcePath: string): string {
  const base = path.basename(sourcePath);
  const num = /sprint-(\d+)/i.exec(base)?.[1];
  const padded = num ? num.padStart(2, "0") : "01";
  return `sprint-${padded}-imported`;
}

function planTicket(
  ticket: ScannedFile,
  sprintId: string,
  action: ImportFileAction,
): { file: ImportPlanFile; findings: ImportFinding[] } {
  const findings: ImportFinding[] = [];
  const targetFile = `${sprintId}/tickets/${ticket.basename}`;

  const prefix = /^(T\d+)/i.exec(ticket.basename)?.[1];
  const ticketId = prefix && /^T\d{2,}$/.test(prefix) ? prefix : (prefix ?? "T??");
  if (!prefix || !/^T\d{2,}$/.test(prefix)) {
    findings.push(
      importFinding("warning", ImportCode.IMPORT_AMBIGUOUS_TICKET_ID, `could not derive a canonical ticket id from filename ${ticket.basename}`, {
        sourceFile: ticket.file,
        targetFile,
      }),
    );
  }

  if (inferKind(ticket.basename) === undefined) {
    findings.push(
      importFinding("warning", ImportCode.IMPORT_AMBIGUOUS_TICKET_KIND, `ticket ${ticketId}: kind could not be inferred from the filename`, {
        sourceFile: ticket.file,
        targetFile,
      }),
    );
  }

  checkField(ticket, "risk", RiskEnum, ImportCode.IMPORT_AMBIGUOUS_RISK, ticketId, targetFile, findings);
  checkField(ticket, "change_class", ChangeClassEnum, ImportCode.IMPORT_AMBIGUOUS_CHANGE_CLASS, ticketId, targetFile, findings);
  checkField(ticket, "blast_radius", BlastRadiusEnum, ImportCode.IMPORT_AMBIGUOUS_BLAST_RADIUS, ticketId, targetFile, findings);

  if (!hasAcceptanceSection(ticket.text)) {
    findings.push(
      importFinding("warning", ImportCode.IMPORT_MISSING_ACCEPTANCE_CRITERIA, `ticket ${ticketId}: no Acceptance Criteria section found in legacy content`, {
        sourceFile: ticket.file,
        targetFile,
      }),
    );
  }

  findings.push(
    importFinding("info", ImportCode.IMPORT_PROSE_PRESERVED, `ticket ${ticketId}: legacy prose preserved from ${ticket.file}`, {
      sourceFile: ticket.file,
      targetFile,
    }),
  );

  return { file: { targetFile, action, sourceFiles: [ticket.file] }, findings };
}

function inferKind(basename: string): string | undefined {
  const lower = basename.toLowerCase();
  if (lower.includes("closeout")) return "closeout";
  if (lower.includes("plan")) return "plan";
  if (lower.includes("test")) return "red";
  if (lower.includes("impl") || lower.includes("green")) return "green";
  return undefined;
}

function checkField(
  ticket: ScannedFile,
  key: string,
  schema: EnumSchema,
  code: ImportCodeValue,
  ticketId: string,
  targetFile: string,
  findings: ImportFinding[],
): void {
  const match = new RegExp(`^\\s*${key}\\s*:\\s*(\\S+)`, "im").exec(ticket.text);
  const value = match?.[1];
  if (value === undefined || !schema.safeParse(value).success) {
    findings.push(
      importFinding("warning", code, `ticket ${ticketId}: ${key} is ambiguous and needs a human decision`, {
        sourceFile: ticket.file,
        targetFile,
      }),
    );
  }
}

function hasAcceptanceSection(text: string): boolean {
  const lines = text.split(/\r\n?|\n/);
  const headingIndex = lines.findIndex((line) => /^#{2,}\s+acceptance(\s+criteria)?\s*$/i.test(line.trim()));
  if (headingIndex === -1) return false;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    if (/^#{1,6}\s/.test(line)) break;
    if (line !== "") return true;
  }
  return false;
}
