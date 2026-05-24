import { buildReport, type ValidationReport } from "../validate/findings.js";
import { validateIntegrity } from "../validate/integrity.js";
import { loadContract } from "../validate/load.js";
import { validateReadiness } from "../validate/readiness.js";
import { validateContract } from "../validate/validate-contract.js";
import { formatReportHuman, formatStatusHuman } from "./format.js";

/** IO boundary so the runner is fully testable without touching stdout or disk. */
export type CliIo = {
  print: (text: string) => void;
  printError: (text: string) => void;
  writeArtifact: (epicPath: string, report: ValidationReport) => void;
};

const USAGE = "usage: forge <validate|status> <epic-path> [--json]";

export function runCli(argv: string[], io: CliIo): number {
  const [command, epicPath, ...rest] = argv;

  if (command === "validate") {
    if (epicPath === undefined) return usageError(io);
    return runValidate(epicPath, rest.includes("--json"), io);
  }

  if (command === "status") {
    if (epicPath === undefined) return usageError(io);
    return runStatus(epicPath, io);
  }

  return usageError(io);
}

function usageError(io: CliIo): number {
  io.printError(USAGE);
  return 2;
}

function runValidate(epicPath: string, asJson: boolean, io: CliIo): number {
  const report = validateContract(epicPath);
  if (asJson) {
    io.print(JSON.stringify(report, null, 2));
  } else {
    io.print(formatReportHuman(report));
    io.writeArtifact(epicPath, report);
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
