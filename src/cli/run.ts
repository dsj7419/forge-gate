import * as fs from "node:fs";
import * as path from "node:path";

import { parseAgentOutput, type AgentRole } from "../agents/parse-output.js";
import { runGuardPaths } from "../guard/cli.js";
import { runVerifyInstall } from "../install/cli.js";
import { emitActiveTicket } from "./active-ticket.js";
import { planImport } from "../importer/plan.js";
import { executeImport } from "../importer/write.js";
import { buildAgentDispatch, buildPmDispatch, type PmRawInputs } from "../orchestrator/dispatch.js";
import { generateRunPackets } from "../orchestrator/packets.js";
import { runDryRun } from "../run/dry-run.js";
import { defaultRunReportIo, runWriteRunReport, type RunReportIo } from "../run-report/cli.js";
import { buildReport, type ValidationReport } from "../validate/findings.js";
import { validateIntegrity } from "../validate/integrity.js";
import { loadContract } from "../validate/load.js";
import { validateReadiness } from "../validate/readiness.js";
import { validateContract } from "../validate/validate-contract.js";
import {
  formatImportPlanHuman,
  formatImportResultHuman,
  formatReportHuman,
  formatRunDryRunHuman,
  formatStatusHuman,
} from "./format.js";

/** IO boundary so the runner is fully testable without touching stdout or disk. */
export type CliIo = {
  print: (text: string) => void;
  printError: (text: string) => void;
  /** May throw; runValidate converts a failure into a controlled non-zero exit. */
  writeArtifact: (epicPath: string, report: ValidationReport) => void;
};

/**
 * Optional injected IO seams. Tests pass these to keep `forge run-report write`
 * from touching the real filesystem; production calls let them default.
 */
export type RunCliOptions = {
  runReportIo?: RunReportIo;
};

const USAGE =
  "usage: forge validate <epic-path> [--json]\n" +
  "       forge status <epic-path>\n" +
  "       forge run <epic-path> --dry-run [--json]\n" +
  "       forge import --from-existing <legacy-sprint-path> --out <epic-root> [--dry-run] [--json]\n" +
  "       forge packets <epic-path> [--repo-root <path>]\n" +
  "       forge dispatch <engineer|semantic-verifier|scope-verifier> <epic-path> [--repo-root <path>]\n" +
  "       forge dispatch pm <epic-path> --assigned-decision-id <D-NNN> [--engineer-output <f> --semantic-output <f> --scope-output <f> --facts <f.json>] [--repo-root <path>]\n" +
  "       forge parse-agent <role> (--file <path> | --stdin) [--expected-decision-id <D-NNN> (pm only)]\n" +
  "       forge active-ticket <epic-path> [--json] [--repo-root <path>]\n" +
  "       forge guard paths [--active <active-ticket.json>] [--json] [--repo-root <path>]\n" +
  "       forge run-report write <epic-path> --repo-root <p> --result PASS|ESCALATE --ticket-title <s> --checkpoint-base <sha> --checkpoint-head <sha> --guard-result <s> --guard-exit <n> [--engineer-output <p>] [--semantic-output <p>] [--scope-output <p>] [--pm-output <p>] [--facts <p>] [--active-ticket <p>] [--out <p>] [--proposed-status-transition <s>] [--suggested-commit-message <s>] [--suggested-command <s>] [--note <s>]\n" +
  "       forge verify-install";

export function runCli(argv: string[], io: CliIo, options: RunCliOptions = {}): number {
  const [command, epicPath, ...flags] = argv;

  if (command === "run-report") {
    return runWriteRunReport(argv.slice(1), io, options.runReportIo ?? defaultRunReportIo);
  }

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

  if (command === "packets") {
    if (!isUsablePath(epicPath)) return usageError(io);
    const unknown = flags.filter((flag) => flag.startsWith("--") && flag !== "--repo-root");
    if (unknown.length > 0) return usageError(io, `unknown option(s): ${unknown.join(", ")}`);
    const result = generateRunPackets(epicPath, flagValue(flags, "--repo-root") ?? process.cwd());
    if (!result.ok) {
      io.print(JSON.stringify({ ok: false, blockedReasons: result.blockedReasons }, null, 2));
      return 1;
    }
    io.print(JSON.stringify(result.packets, null, 2));
    return 0;
  }

  if (command === "dispatch") {
    const role = epicPath; // argv[1]
    const dispatchEpic = flags[0]; // argv[2]
    if (!isAgentRole(role) || dispatchEpic === undefined || dispatchEpic.startsWith("--")) {
      return usageError(io, "dispatch requires <role> <epic-path>");
    }
    const rest = flags.slice(1);
    const unknown = rest.filter((arg) => arg.startsWith("--") && !DISPATCH_FLAGS.has(arg));
    if (unknown.length > 0) return usageError(io, `unknown option(s): ${unknown.join(", ")}`);

    const pmInputs = {
      engineer: flagValue(rest, "--engineer-output"),
      semantic: flagValue(rest, "--semantic-output"),
      scope: flagValue(rest, "--scope-output"),
      facts: flagValue(rest, "--facts"),
    };
    const assignedDecisionId = flagValue(rest, "--assigned-decision-id");
    const anyPmInput = Object.values(pmInputs).some((value) => value !== undefined);
    if (anyPmInput && role !== "pm") {
      return usageError(io, "agent-output inputs are only valid for `dispatch pm`");
    }
    if (assignedDecisionId !== undefined && role !== "pm") {
      return usageError(io, "--assigned-decision-id is only valid for `dispatch pm`");
    }
    if (anyPmInput && Object.values(pmInputs).some((value) => value === undefined)) {
      return usageError(io, "dispatch pm input assembly requires --engineer-output, --semantic-output, --scope-output, and --facts");
    }
    // `dispatch pm` is the orchestrator's path to a Core-pinned monotonic decision id; the
    // flag is therefore required for the pm role (even without assembled agent inputs) so
    // the assigned id is always rendered into the PM packet skeleton.
    if (role === "pm" && assignedDecisionId === undefined) {
      io.print(
        JSON.stringify(
          {
            ok: false,
            code: "ASSIGNED_DECISION_ID_REQUIRED",
            source: "assigned_decision_id",
            errors: ["`forge dispatch pm` requires --assigned-decision-id <D-NNN> (Core-pinned by the orchestrator)"],
          },
          null,
          2,
        ),
      );
      return 1;
    }
    if (assignedDecisionId !== undefined && !ASSIGNED_DECISION_ID_PATTERN.test(assignedDecisionId)) {
      io.print(
        JSON.stringify(
          {
            ok: false,
            code: "ASSIGNED_DECISION_ID_REQUIRED",
            source: "assigned_decision_id",
            errors: [`--assigned-decision-id must match D-<digits>; got ${JSON.stringify(assignedDecisionId)}`],
          },
          null,
          2,
        ),
      );
      return 1;
    }

    const result = generateRunPackets(dispatchEpic, flagValue(rest, "--repo-root") ?? process.cwd());
    if (!result.ok) {
      io.print(JSON.stringify({ ok: false, blockedReasons: result.blockedReasons }, null, 2));
      return 1;
    }
    const options = { registeredAvailable: false, agentsDir: path.join(process.cwd(), "agents") };

    if (anyPmInput) {
      let raw: PmRawInputs;
      try {
        raw = {
          engineer: fs.readFileSync(pmInputs.engineer as string, "utf8"),
          semantic: fs.readFileSync(pmInputs.semantic as string, "utf8"),
          scope: fs.readFileSync(pmInputs.scope as string, "utf8"),
          facts: fs.readFileSync(pmInputs.facts as string, "utf8"),
          assignedDecisionId: assignedDecisionId as string,
        };
      } catch (thrown) {
        const error = thrown instanceof Error ? thrown.message : String(thrown);
        io.print(JSON.stringify({ ok: false, code: "INPUT_FILE_UNREADABLE", error }, null, 2));
        return 1;
      }
      const pm = buildPmDispatch(result.packets, raw, options);
      if (!pm.ok) {
        io.print(JSON.stringify(pm, null, 2));
        return 1;
      }
      io.print(JSON.stringify(pm.dispatch, null, 2));
      return 0;
    }

    // PM skeleton dispatch (no assembled inputs yet) — Core still pins the
    // assigned id into the rendered packet so the prompt carries the
    // authoritative section even before the upstream outputs are gathered.
    if (role === "pm") {
      const packetsWithId = {
        ...result.packets,
        pm: {
          ...result.packets.pm,
          inputs: { ...result.packets.pm.inputs, assigned_decision_id: assignedDecisionId as string },
        },
      };
      const dispatch = buildAgentDispatch(role, packetsWithId, options);
      io.print(JSON.stringify(dispatch, null, 2));
      return 0;
    }

    const dispatch = buildAgentDispatch(role, result.packets, options);
    io.print(JSON.stringify(dispatch, null, 2));
    return 0;
  }

  if (command === "active-ticket") {
    if (!isUsablePath(epicPath)) return usageError(io);
    const unknown = flags.filter((flag) => flag.startsWith("--") && flag !== "--json" && flag !== "--repo-root");
    if (unknown.length > 0) return usageError(io, `unknown option(s): ${unknown.join(", ")}`);
    const result = emitActiveTicket(epicPath, flagValue(flags, "--repo-root") ?? process.cwd());
    if (!result.ok) {
      io.print(JSON.stringify({ ok: false, blockedReasons: result.blockedReasons }, null, 2));
      return 1;
    }
    io.print(JSON.stringify(result.activeTicket, null, 2));
    return 0;
  }

  if (command === "guard") {
    return runGuardPaths(argv.slice(1), io);
  }

  if (command === "verify-install") {
    return runVerifyInstall(argv.slice(1), io);
  }

  if (command === "parse-agent") {
    const role = epicPath; // argv[1]
    if (!isAgentRole(role)) return usageError(io, "parse-agent requires a valid <role>");
    const unknown = flags.filter((flag) => flag.startsWith("--") && !PARSE_AGENT_FLAGS.has(flag));
    if (unknown.length > 0) return usageError(io, `unknown option(s): ${unknown.join(", ")}`);

    const expectedDecisionId = flagValue(flags, "--expected-decision-id");
    if (expectedDecisionId !== undefined && role !== "pm") {
      return usageError(io, "--expected-decision-id is only valid for `parse-agent pm`");
    }

    const fileIndex = flags.indexOf("--file");
    let raw: string;
    if (fileIndex !== -1) {
      const file = flags[fileIndex + 1];
      if (file === undefined) return usageError(io, "parse-agent --file requires a path");
      raw = fs.readFileSync(file, "utf8");
    } else if (flags.includes("--stdin")) {
      raw = fs.readFileSync(0, "utf8");
    } else {
      return usageError(io, "parse-agent requires --file <path> or --stdin");
    }
    const result = parseAgentOutput(role, raw);
    // Post-validation cross-check: after the strict schema parse, if the caller
    // pinned an expected decision_id (Core-assigned monotonically from the
    // ledger), the emitted value must equal it verbatim. The schema is *not*
    // changed for this — it is a CLI-layer guard so the PM agent cannot
    // silently invent or renumber the id.
    if (result.ok && role === "pm" && expectedDecisionId !== undefined) {
      const emitted = (result.data as { decision_id: string }).decision_id;
      if (emitted !== expectedDecisionId) {
        io.print(
          JSON.stringify(
            {
              ok: false,
              code: "DECISION_ID_MISMATCH",
              expected: expectedDecisionId,
              actual: emitted,
              errors: [
                `pm emitted decision_id ${JSON.stringify(emitted)} but Core pinned ${JSON.stringify(expectedDecisionId)}`,
              ],
            },
            null,
            2,
          ),
        );
        return 1;
      }
    }
    io.print(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }

  if (command === "run") {
    if (!isUsablePath(epicPath)) return usageError(io);
    const unknown = flags.filter((flag) => flag !== "--dry-run" && flag !== "--json");
    if (unknown.length > 0) return usageError(io, `unknown option(s): ${unknown.join(", ")}`);
    if (!flags.includes("--dry-run")) {
      return usageError(io, "live run is not implemented yet; pass --dry-run");
    }
    const report = runDryRun(epicPath);
    io.print(flags.includes("--json") ? JSON.stringify(report, null, 2) : formatRunDryRunHuman(report));
    return report.ok ? 0 : 1;
  }

  return usageError(io);
}

const IMPORT_FLAGS = new Set(["--from-existing", "--out", "--dry-run", "--json"]);
const DISPATCH_FLAGS = new Set([
  "--engineer-output",
  "--semantic-output",
  "--scope-output",
  "--facts",
  "--assigned-decision-id",
  "--json",
  "--repo-root",
]);
const PARSE_AGENT_FLAGS = new Set(["--file", "--stdin", "--expected-decision-id"]);
const ASSIGNED_DECISION_ID_PATTERN = /^D-\d+$/;

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

function isAgentRole(value: string | undefined): value is AgentRole {
  return value === "engineer" || value === "semantic-verifier" || value === "scope-verifier" || value === "pm";
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
