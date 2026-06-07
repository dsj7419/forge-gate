import * as fs from "node:fs";
import * as path from "node:path";

import { ingestAgentOutput } from "../agents/ingest.js";
import { parseAgentOutput, type ParseResult } from "../agents/parse-output.js";
import { toRoleJsonSchema, type AgentRole } from "../agents/schemas.js";
import { runGuardPaths } from "../guard/cli.js";
import { runVerifyInstall } from "../install/cli.js";
import { emitActiveTicket } from "./active-ticket.js";
import { planImport } from "../importer/plan.js";
import { executeImport } from "../importer/write.js";
import { buildAgentDispatch, buildPmDispatch, type PmRawInputs } from "../orchestrator/dispatch.js";
import { generateRunPackets } from "../orchestrator/packets.js";
import { nextDecisionId } from "../orchestrator/decision-id.js";
import { readDecisionsLedger, type DecisionsLedgerIo } from "../orchestrator/decisions-ledger.js";
import { defaultDecisionsLedgerIo, runLedger } from "../orchestrator/ledger-cli.js";
import { defaultLockIo, runLock } from "../orchestrator/lock-cli.js";
import type { LockIo } from "../orchestrator/lock.js";
import { defaultRepoGit, runRepo, type RepoGit } from "../repo/snapshot.js";
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
  decisionsLedgerIo?: DecisionsLedgerIo;
  lockIo?: LockIo;
  repoGit?: RepoGit;
};

const USAGE =
  "usage: forge validate <epic-path> [--json]\n" +
  "       forge status <epic-path>\n" +
  "       forge run <epic-path> --dry-run [--json]\n" +
  "       forge import --from-existing <legacy-sprint-path> --out <epic-root> [--dry-run] [--json]\n" +
  "       forge packets <epic-path> [--repo-root <path>]\n" +
  "       forge dispatch <engineer|semantic-verifier|scope-verifier> <epic-path> [--repo-root <path>]\n" +
  "       forge dispatch pm <epic-path> [--assigned-decision-id <D-NNN> (optional cross-check)] [--engineer-output <f> --semantic-output <f> --scope-output <f> --facts <f.json>] [--repo-root <path>]\n" +
  "       forge ledger append <epic> --decision-id <D-NNN> --ticket <ticket> --branch <branch>\n" +
  "       forge lock acquire <epic> --run-id <id> --session-id <s> --ticket <t> --branch <b> --repo-root <r>\n" +
  "       forge lock release <epic> --run-id <id>\n" +
  "       forge lock status <epic> [--heartbeat-ttl-ms <n>] [--acquire-ttl-ms <n>]\n" +
  "       forge repo snapshot --repo-root <path> [--base <sha>]\n" +
  "       forge parse-agent <role> (--file <path> | --stdin | --json-file <path> | --json-stdin) [--expected-decision-id <D-NNN> (pm only)]\n" +
  "       forge agent-schema <role>\n" +
  "       forge active-ticket <epic-path> [--json] [--repo-root <path>]\n" +
  "       forge guard paths [--active <active-ticket.json>] [--json] [--repo-root <path>]\n" +
  "       forge run-report write <epic-path> --repo-root <p> --result PASS|ESCALATE --ticket-title <s> --checkpoint-base <sha> --checkpoint-head <sha> --guard-result <s> --guard-exit <n> --gate-declared <g> --gate-effective <g> --gate-human-required <true|false> [--engineer-output <p>] [--semantic-output <p>] [--scope-output <p>] [--pm-output <p>] [--facts <p>] [--active-ticket <p>] [--out <p>] [--proposed-status-transition <s>] [--suggested-commit-message <s>] [--suggested-command <s>] [--note <s>]\n" +
  "       forge verify-install";

export function runCli(argv: string[], io: CliIo, options: RunCliOptions = {}): number {
  const [command, epicPath, ...flags] = argv;

  if (command === "run-report") {
    return runWriteRunReport(argv.slice(1), io, options.runReportIo ?? defaultRunReportIo);
  }

  if (command === "ledger") {
    return runLedger(argv.slice(1), io, options.decisionsLedgerIo ?? defaultDecisionsLedgerIo);
  }

  if (command === "lock") {
    return runLock(argv.slice(1), io, options.lockIo ?? defaultLockIo);
  }

  if (command === "repo") {
    return runRepo(argv.slice(1), io, options.repoGit ?? defaultRepoGit);
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
    // `--assigned-decision-id` is now an OPTIONAL cross-check. Core itself assigns
    // the authoritative monotonic id from the per-epic decisions ledger (read
    // below). When the flag is supplied it must still be well-formed before it can
    // be compared against Core's computed id.
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
    const dispatchOptions = { registeredAvailable: false, agentsDir: path.join(process.cwd(), "agents") };

    // Core-owned decision_id assignment for the pm role. The id is sourced from
    // `<epic>/.forge/decisions-ledger.json` through Core (the same allocator the
    // ledger appender uses), never from the flag. `--assigned-decision-id` is an
    // optional cross-check: omitted → use Core's id; supplied + equal → succeed;
    // supplied + unequal → DECISION_ID_PROVENANCE_MISMATCH with no prompt rendered.
    // A missing ledger → D-001; a malformed ledger → LEDGER_INVALID, fail-closed.
    let coreDecisionId: string | undefined;
    if (role === "pm") {
      const ledgerIo = options.decisionsLedgerIo ?? defaultDecisionsLedgerIo;
      const ledgerFile = ledgerPathFor(dispatchEpic);
      const ledger = readDecisionsLedger(ledgerFile, ledgerIo);
      if (!ledger.ok) {
        io.print(JSON.stringify({ ok: false, code: ledger.code, errors: ledger.errors }, null, 2));
        return 1;
      }
      coreDecisionId = nextDecisionId(ledger.ledger.decisions.map((d) => d.decision_id));
      if (assignedDecisionId !== undefined && assignedDecisionId !== coreDecisionId) {
        io.print(
          JSON.stringify(
            {
              ok: false,
              code: "DECISION_ID_PROVENANCE_MISMATCH",
              source: "assigned_decision_id",
              expected: coreDecisionId,
              actual: assignedDecisionId,
              errors: [
                `--assigned-decision-id ${assignedDecisionId} disagrees with Core's computed id ${coreDecisionId} (sourced from ${ledgerFile})`,
              ],
            },
            null,
            2,
          ),
        );
        return 1;
      }
    }

    if (anyPmInput) {
      let raw: PmRawInputs;
      try {
        raw = {
          engineer: fs.readFileSync(pmInputs.engineer as string, "utf8"),
          semantic: fs.readFileSync(pmInputs.semantic as string, "utf8"),
          scope: fs.readFileSync(pmInputs.scope as string, "utf8"),
          facts: fs.readFileSync(pmInputs.facts as string, "utf8"),
          assignedDecisionId: coreDecisionId as string,
        };
      } catch (thrown) {
        const error = thrown instanceof Error ? thrown.message : String(thrown);
        io.print(JSON.stringify({ ok: false, code: "INPUT_FILE_UNREADABLE", error }, null, 2));
        return 1;
      }
      const pm = buildPmDispatch(result.packets, raw, dispatchOptions);
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
          inputs: { ...result.packets.pm.inputs, assigned_decision_id: coreDecisionId as string },
        },
      };
      const dispatch = buildAgentDispatch(role, packetsWithId, dispatchOptions);
      io.print(JSON.stringify(dispatch, null, 2));
      return 0;
    }

    const dispatch = buildAgentDispatch(role, result.packets, dispatchOptions);
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

  if (command === "agent-schema") {
    const role = epicPath; // argv[1]
    if (!isAgentRole(role)) return usageError(io, "agent-schema requires a valid <role>");
    if (flags.length > 0) return usageError(io, `unknown option(s): ${flags.join(", ")}`);
    io.print(JSON.stringify(toRoleJsonSchema(role), null, 2));
    return 0;
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

    // Exactly one input mode is allowed. The two YAML modes (--file/--stdin) route
    // through parseAgentOutput; the two structured modes (--json-file/--json-stdin)
    // JSON.parse to an object and route through ingestAgentOutput. Combining modes
    // is a usage error (exit 2). Malformed JSON is AGENT_OUTPUT_INVALID, never repaired.
    const modes = INPUT_MODES.filter((mode) => flags.includes(mode));
    if (modes.length === 0) {
      return usageError(io, "parse-agent requires --file <path>, --stdin, --json-file <path>, or --json-stdin");
    }
    if (modes.length > 1) {
      return usageError(io, `exactly one input mode is allowed; got: ${modes.join(", ")}`);
    }
    const mode = modes[0];

    let result: ParseResult<unknown>;
    if (mode === "--file" || mode === "--stdin") {
      let raw: string;
      if (mode === "--file") {
        const file = flagValue(flags, "--file");
        if (file === undefined) return usageError(io, "parse-agent --file requires a path");
        raw = fs.readFileSync(file, "utf8");
      } else {
        raw = fs.readFileSync(0, "utf8");
      }
      result = parseAgentOutput(role, raw);
    } else {
      let text: string;
      if (mode === "--json-file") {
        const file = flagValue(flags, "--json-file");
        if (file === undefined) return usageError(io, "parse-agent --json-file requires a path");
        text = fs.readFileSync(file, "utf8");
      } else {
        text = fs.readFileSync(0, "utf8");
      }
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch (thrown) {
        const detail = thrown instanceof Error ? thrown.message : String(thrown);
        result = { ok: false, code: "AGENT_OUTPUT_INVALID", errors: [`malformed JSON: ${detail}`] };
        io.print(JSON.stringify(result, null, 2));
        return 1;
      }
      result = ingestAgentOutput(role, { source: "structured", value });
    }

    // Post-validation cross-check (both paths): after the strict schema parse, if the
    // caller pinned an expected decision_id (Core-assigned monotonically from the
    // ledger), the emitted value must equal it verbatim. The schema is *not* changed
    // for this — it is a CLI-layer guard so the PM agent cannot silently invent or
    // renumber the id.
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
const PARSE_AGENT_FLAGS = new Set(["--file", "--stdin", "--json-file", "--json-stdin", "--expected-decision-id"]);
const INPUT_MODES = ["--file", "--stdin", "--json-file", "--json-stdin"] as const;
const ASSIGNED_DECISION_ID_PATTERN = /^D-\d+$/;

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value !== undefined && !value.startsWith("--") ? value : undefined;
}

/** Locate the per-epic decisions ledger from a dispatch epic path. */
function ledgerPathFor(epic: string): string {
  return `${epic.replace(/[\\/]+$/, "")}/.forge/decisions-ledger.json`;
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
