import { planImport } from "../importer/plan.js";
import { executeImport } from "../importer/write.js";
import { buildReport, type ValidationReport } from "../validate/findings.js";
import { validateIntegrity } from "../validate/integrity.js";
import { loadContract } from "../validate/load.js";
import { validateReadiness } from "../validate/readiness.js";
import { validateContract } from "../validate/validate-contract.js";
import { formatImportPlanHuman, formatImportResultHuman, formatReportHuman, formatStatusHuman } from "./format.js";

/** IO boundary so the runner is fully testable without touching stdout or disk. */
export type CliIo = {
  print: (text: string) => void;
  printError: (text: string) => void;
  /** May throw; runValidate converts a failure into a controlled non-zero exit. */
  writeArtifact: (epicPath: string, report: ValidationReport) => void;
};

const USAGE =
  "usage: forge validate <epic-path> [--json]\n" +
  "       forge status <epic-path>\n" +
  "       forge import --from-existing <legacy-sprint-path> --out <epic-root> --dry-run [--json]";

export function runCli(argv: string[], io: CliIo): number {
  const [command, epicPath, ...flags] = argv;

  if (command === "validate") {
    if (!isUsablePath(epicPath)) return usageError(io);
    const unknown = flags.filter((flag) => flag !== "--json");
    if (unknown.length > 0) return usageError(io, `unknown option(s): ${unknown.join(", ")}`);
    return runValidate(epicPath, flags.includes("--json"), io);
  }

  if (command === "status") {
    if (!isUsablePath(epicPath)) return usageError(io);
    if (flags.length > 0) return usageError(io, `unknown option(s): ${flags.join(", ")}`);
    return runStatus(epicPath, io);
  }

  if (command === "import") {
    return runImport(argv.slice(1), io);
  }

  return usageError(io);
}

const IMPORT_FLAGS = new Set(["--from-existing", "--out", "--dry-run", "--json"]);

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value !== undefined && !value.startsWith("--") ? value : undefined;
}

function runImport(args: string[], io: CliIo): number {
  const unknown = args.filter((arg) => arg.startsWith("--") && !IMPORT_FLAGS.has(arg));
  if (unknown.length > 0) return usageError(io, `unknown option(s): ${unknown.join(", ")}`);

  const fromExisting = flagValue(args, "--from-existing");
  const out = flagValue(args, "--out");
  if (fromExisting === undefined || out === undefined) {
    return usageError(io, "import requires --from-existing <legacy-sprint-path> --out <epic-root>");
  }
  const asJson = args.includes("--json");

  if (args.includes("--dry-run")) {
    const plan = planImport(fromExisting, out, { dryRun: true });
    io.print(asJson ? JSON.stringify(plan, null, 2) : formatImportPlanHuman(plan));
    return plan.ok ? 0 : 1;
  }

  const result = executeImport(fromExisting, out);
  io.print(asJson ? JSON.stringify(result, null, 2) : formatImportResultHuman(result));
  return result.ok ? 0 : 1;
}

function isUsablePath(epicPath: string | undefined): epicPath is string {
  return epicPath !== undefined && !epicPath.startsWith("--");
}

function usageError(io: CliIo, detail?: string): number {
  if (detail !== undefined) io.printError(detail);
  io.printError(USAGE);
  return 2;
}

function runValidate(epicPath: string, asJson: boolean, io: CliIo): number {
  const report = validateContract(epicPath);

  if (asJson) {
    io.print(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  }

  io.print(formatReportHuman(report));
  try {
    io.writeArtifact(epicPath, report);
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    io.printError(`validation completed, but writing .forge/validation-report.json failed: ${message}`);
    return 1;
  }
  return report.ok ? 0 : 1;
}

function runStatus(epicPath: string, io: CliIo): number {
  const { contract, findings } = loadContract(epicPath);
  if (!contract) {
    // Status is informational, but a contract that cannot load at all is a hard failure.
    io.print(formatReportHuman(buildReport(epicPath, findings)));
    return 1;
  }
  const allFindings = [...findings, ...validateIntegrity(contract), ...validateReadiness(contract)];
  io.print(formatStatusHuman(contract, allFindings));
  return 0;
}
