import * as path from "node:path";

import { BlastRadiusEnum, ChangeClassEnum, RiskEnum } from "../schema/enums.js";
import {
  ImportCode,
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

/** A legacy ticket's derived canonical fields. Ambiguous fields are `undefined` (never invented). */
export type DerivedTicket = {
  basename: string;
  sourceFile: string;
  id: string;
  idAmbiguous: boolean;
  title: string;
  kind: string | undefined;
  risk: string | undefined;
  change_class: string | undefined;
  blast_radius: string | undefined;
  hasAcceptance: boolean;
  body: string;
};

export function deriveEpicId(outPath: string): string {
  return path.basename(outPath) || "imported-epic";
}

export function deriveSprintId(sourcePath: string): string {
  const num = /sprint-(\d+)/i.exec(path.basename(sourcePath))?.[1];
  const padded = num ? num.padStart(2, "0") : "01";
  return `sprint-${padded}-imported`;
}

export function deriveTicket(file: ScannedFile): DerivedTicket {
  const prefix = /^(T\d+)/i.exec(file.basename)?.[1];
  const canonicalId = prefix !== undefined && /^T\d{2,}$/.test(prefix);
  return {
    basename: file.basename,
    sourceFile: file.file,
    id: canonicalId ? prefix : (prefix ?? "T??"),
    idAmbiguous: !canonicalId,
    title: deriveTitle(file.text, file.basename),
    kind: inferKind(file.basename),
    risk: readField(file.text, "risk", RiskEnum),
    change_class: readField(file.text, "change_class", ChangeClassEnum),
    blast_radius: readField(file.text, "blast_radius", BlastRadiusEnum),
    hasAcceptance: hasAcceptanceSection(file.text),
    body: file.text,
  };
}

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
  const epicId = deriveEpicId(outPath);
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
    const derived = deriveTicket(ticket);
    const targetFile = `${sprintId}/tickets/${ticket.basename}`;
    files.push({ targetFile, action, sourceFiles: [ticket.file] });
    findings.push(...ticketFindings(derived, targetFile));
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

/** Findings for one derived ticket, shared by dry-run and live import. */
export function ticketFindings(derived: DerivedTicket, targetFile: string): ImportFinding[] {
  const at = { sourceFile: derived.sourceFile, targetFile };
  const findings: ImportFinding[] = [];
  if (derived.idAmbiguous) {
    findings.push(importFinding("warning", ImportCode.IMPORT_AMBIGUOUS_TICKET_ID, `could not derive a canonical ticket id from filename ${derived.basename}`, at));
  }
  if (derived.kind === undefined) {
    findings.push(importFinding("warning", ImportCode.IMPORT_AMBIGUOUS_TICKET_KIND, `ticket ${derived.id}: kind could not be inferred from the filename`, at));
  }
  if (derived.risk === undefined) {
    findings.push(importFinding("warning", ImportCode.IMPORT_AMBIGUOUS_RISK, `ticket ${derived.id}: risk is ambiguous and needs a human decision`, at));
  }
  if (derived.change_class === undefined) {
    findings.push(importFinding("warning", ImportCode.IMPORT_AMBIGUOUS_CHANGE_CLASS, `ticket ${derived.id}: change_class is ambiguous and needs a human decision`, at));
  }
  if (derived.blast_radius === undefined) {
    findings.push(importFinding("warning", ImportCode.IMPORT_AMBIGUOUS_BLAST_RADIUS, `ticket ${derived.id}: blast_radius is ambiguous and needs a human decision`, at));
  }
  if (!derived.hasAcceptance) {
    findings.push(importFinding("warning", ImportCode.IMPORT_MISSING_ACCEPTANCE_CRITERIA, `ticket ${derived.id}: no Acceptance Criteria section found in legacy content`, at));
  }
  // Legacy tickets carry no canonical verify_commands; red/green tickets need them to be execution-ready.
  if (derived.kind === "red" || derived.kind === "green") {
    findings.push(importFinding("warning", ImportCode.IMPORT_AMBIGUOUS_VERIFY_COMMANDS, `ticket ${derived.id}: a ${derived.kind} ticket needs verify_commands; none found in legacy content`, at));
  }
  findings.push(importFinding("info", ImportCode.IMPORT_PROSE_PRESERVED, `ticket ${derived.id}: legacy prose preserved from ${derived.basename}`, at));
  return findings;
}

function inferKind(basename: string): string | undefined {
  const lower = basename.toLowerCase();
  if (lower.includes("closeout")) return "closeout";
  if (lower.includes("plan")) return "plan";
  if (lower.includes("test")) return "red";
  if (lower.includes("impl") || lower.includes("green")) return "green";
  return undefined;
}

function deriveTitle(text: string, basename: string): string {
  const heading = /^#\s+(.+)$/m.exec(text)?.[1];
  return (heading ?? basename).trim();
}

function readField(text: string, key: string, schema: EnumSchema): string | undefined {
  const value = new RegExp(`^\\s*${key}\\s*:\\s*(\\S+)`, "im").exec(text)?.[1];
  return value !== undefined && schema.safeParse(value).success ? value : undefined;
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
