import { buildReport, type ValidationReport } from "./findings.js";
import { validateIntegrity } from "./integrity.js";
import { loadContract } from "./load.js";
import { validateReadiness } from "./readiness.js";

/**
 * The composed validator: load the contract, then (if it loaded) run the
 * integrity and execution-readiness stages, and fold everything into a single
 * ValidationReport. This is the read-only entry point the `forge validate` CLI
 * will wrap. It performs filesystem reads (via loadContract) but no writes.
 */
export function validateContract(epicPath: string): ValidationReport {
  const { contract, findings } = loadContract(epicPath);
  const allFindings = [...findings];
  if (contract) {
    allFindings.push(...validateIntegrity(contract), ...validateReadiness(contract));
  }
  return buildReport(epicPath, allFindings);
}
