import * as fs from "node:fs";
import * as path from "node:path";

import type { ValidationReport } from "../validate/findings.js";
import { validateContract } from "../validate/validate-contract.js";
import {
  generateDecisionsMd,
  generateEpicMd,
  generateEpicYaml,
  generateJournalMd,
  generateManifestYaml,
  generateSprintMd,
  generateTicketMd,
} from "./generate.js";
import { ImportCode, type ImportFinding, importFinding } from "./import-findings.js";
import { deriveEpicId, deriveSprintId, deriveTicket, planImport } from "./plan.js";
import { scanLegacySprint } from "./scan.js";

export type ImportResult = {
  ok: boolean;
  wrote: boolean;
  createdFiles: string[];
  importFindings: ImportFinding[];
  validation?: ValidationReport;
  generatedContractValid: boolean;
};

function outputNonEmpty(outPath: string): boolean {
  try {
    return fs.readdirSync(outPath).length > 0;
  } catch {
    return false;
  }
}

function writeFileEnsured(fullPath: string, content: string): void {
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

/**
 * Live import: materialize the canonical Forge contract from a legacy sprint,
 * then validate the generated output. Reuses the dry-run planner for findings
 * and the output-existence policy. Never mutates the legacy source. A
 * mechanically successful write can still produce a contract that is not
 * execution-ready (ambiguous fields become TODO placeholders) — that is
 * surfaced, not hidden.
 */
export function executeImport(sourcePath: string, outPath: string): ImportResult {
  const plan = planImport(sourcePath, outPath, { dryRun: false });
  const importFindings = [...plan.findings];

  if (importFindings.some((finding) => finding.code === ImportCode.IMPORT_SOURCE_MISSING)) {
    return { ok: false, wrote: false, createdFiles: [], importFindings, generatedContractValid: false };
  }

  if (outputNonEmpty(outPath)) {
    importFindings.push(
      importFinding("error", ImportCode.IMPORT_OUTPUT_EXISTS, `output path exists and is not empty: ${outPath}`, {
        targetFile: outPath,
      }),
    );
    return { ok: false, wrote: false, createdFiles: [], importFindings, generatedContractValid: false };
  }

  const scan = scanLegacySprint(sourcePath);
  const sprintId = deriveSprintId(sourcePath);
  const epicId = deriveEpicId(outPath);
  const tickets = scan.files.filter((file) => file.kind === "ticket").map(deriveTicket);
  const overview = scan.files.find((file) => file.kind === "overview");
  const decisions = scan.files.find((file) => file.kind === "decisions");

  const created: string[] = [];
  const write = (relativePath: string, content: string): void => {
    writeFileEnsured(path.join(outPath, relativePath), content);
    created.push(relativePath);
  };

  write("epic.yaml", generateEpicYaml(epicId, sprintId));
  write("EPIC.md", generateEpicMd(epicId, sprintId));
  write(`${sprintId}/SPRINT.md`, generateSprintMd(overview?.text));
  write(
    `${sprintId}/manifest.yaml`,
    generateManifestYaml(
      sprintId,
      tickets.map((ticket) => ({ id: ticket.idAmbiguous ? "TODO" : ticket.id, kind: ticket.kind ?? "TODO" })),
    ),
  );
  write(`${sprintId}/JOURNAL.md`, generateJournalMd());
  if (decisions) write("DECISIONS.md", generateDecisionsMd(decisions.text));
  for (const ticket of tickets) {
    write(`${sprintId}/tickets/${ticket.basename}`, generateTicketMd(ticket));
  }

  const validation = validateContract(outPath);
  const generatedContractValid = validation.ok;

  writeFileEnsured(
    path.join(outPath, ".forge", "import-report.json"),
    `${JSON.stringify({ createdFiles: created, importFindings, validation, generatedContractValid }, null, 2)}\n`,
  );

  const ok = generatedContractValid && !importFindings.some((finding) => finding.severity === "error");
  return { ok, wrote: true, createdFiles: created, importFindings, validation, generatedContractValid };
}
