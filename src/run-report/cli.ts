import * as fs from "node:fs";
import * as path from "node:path";

import { parseAgentOutput } from "../agents/parse-output.js";
import type { CliIo } from "../cli/run.js";
import { parseActiveTicket } from "../guard/active-ticket.js";
import { OrchestratorConfirmedFactsSchema } from "../orchestrator/packets.js";

import {
  assembleRunReport,
  type AssembleInputs,
  type RuntimeMetadata,
} from "./assemble.js";

const USAGE =
  "usage: forge run-report write <epic-path>\n" +
  "         --repo-root <path>\n" +
  "         --result PASS|ESCALATE\n" +
  "         --ticket-title <string>\n" +
  "         --checkpoint-base <sha>\n" +
  "         --checkpoint-head <sha>\n" +
  "         --guard-result <string>\n" +
  "         --guard-exit <int>\n" +
  "         [--gate-declared <none|pr|merge|phase|manual>] (optional cross-check)\n" +
  "         [--gate-effective <none|pr|merge|phase|manual>] (optional cross-check)\n" +
  "         [--gate-human-required <true|false>] (optional cross-check)\n" +
  "         [--engineer-output <path>] [--semantic-output <path>] [--scope-output <path>]\n" +
  "         [--pm-output <path>] [--facts <path>] [--active-ticket <path>]\n" +
  "         [--out <path>]\n" +
  "         [--proposed-status-transition <s>] [--suggested-commit-message <s>]\n" +
  "         [--suggested-command <s>] [--note <s>]\n" +
  "         [--agent-output-source-engineer <yaml_text|structured_json|workflow_core_runner>]\n" +
  "         [--agent-output-source-semantic-verifier <yaml_text|structured_json|workflow_core_runner>]\n" +
  "         [--agent-output-source-scope-verifier <yaml_text|structured_json|workflow_core_runner>]\n" +
  "         [--agent-output-source-pm <yaml_text|structured_json|workflow_core_runner>]";

/** The trust-path label values accepted on the per-role agent-output-source flags. */
const AGENT_OUTPUT_SOURCE_VALUES = [
  "yaml_text",
  "structured_json",
  "workflow_core_runner",
] as const;

type AgentOutputSourceValue = (typeof AGENT_OUTPUT_SOURCE_VALUES)[number];

/** Maps each per-role flag to the metadata role key it populates. */
const AGENT_OUTPUT_SOURCE_FLAGS = {
  "--agent-output-source-engineer": "engineer",
  "--agent-output-source-semantic-verifier": "semantic_verifier",
  "--agent-output-source-scope-verifier": "scope_verifier",
  "--agent-output-source-pm": "pm",
} as const;

/**
 * Filesystem seam for `forge run-report write`. The orchestrator/test layer
 * supplies one; the CLI never reads or writes through `node:fs` directly,
 * which is what lets the unit tests prove no stray writes leave the seam.
 *
 * Mirrors `DecisionsLedgerIo` and `InstallReader`'s single-purpose IO style.
 */
export type RunReportIo = {
  readFileIfExists: (file: string) => string | null;
  writeFile: (file: string, contents: string) => void;
};

export const defaultRunReportIo: RunReportIo = {
  readFileIfExists: (file) => {
    try {
      return fs.readFileSync(file, "utf8");
    } catch (thrown) {
      if (isErrno(thrown) && thrown.code === "ENOENT") return null;
      throw thrown;
    }
  },
  writeFile: (file, contents) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, "utf8");
  },
};

const KNOWN_FLAGS = new Set([
  "--repo-root",
  "--result",
  "--ticket-title",
  "--checkpoint-base",
  "--checkpoint-head",
  "--guard-result",
  "--guard-exit",
  "--gate-declared",
  "--gate-effective",
  "--gate-human-required",
  "--engineer-output",
  "--semantic-output",
  "--scope-output",
  "--pm-output",
  "--facts",
  "--active-ticket",
  "--out",
  "--proposed-status-transition",
  "--suggested-commit-message",
  "--suggested-command",
  "--note",
  "--agent-output-source-engineer",
  "--agent-output-source-semantic-verifier",
  "--agent-output-source-scope-verifier",
  "--agent-output-source-pm",
]);

type FailureCode =
  | "MISSING_INPUT"
  | "AGENT_OUTPUT_INVALID"
  | "FACTS_INVALID"
  | "ACTIVE_TICKET_INVALID"
  | "GATE_SOURCE_MISSING"
  | "GATE_PROVENANCE_MISMATCH"
  | "HUMAN_GATE_MISMATCH"
  | "RESULT_REQUIRES_GREEN"
  | "RUN_REPORT_INVALID"
  | "OUT_PATH_OUTSIDE_FORGE";

/**
 * `forge run-report write <epic-path>` — the Core-owned writer for
 * `forge-run-report/v1`. Defaults every file input to the canonical
 * `<epic>/.forge/<name>` location the orchestrator captures to; defaults `--out`
 * to `<epic>/.forge/run-report.json`. Refuses to write anywhere outside
 * `<epic>/.forge/`.
 *
 * The output is deterministic: 2-space JSON indent with a trailing newline,
 * top-level key order pinned by the schema. Two runs over identical inputs
 * produce byte-identical files.
 */
export function runWriteRunReport(args: string[], cli: CliIo, io: RunReportIo): number {
  const subcommand = args[0];
  if (subcommand !== "write") return usage(cli, `unknown subcommand: ${String(subcommand)}`);

  const epicPath = args[1];
  if (epicPath === undefined || epicPath.startsWith("--")) {
    return usage(cli, "run-report write requires <epic-path>");
  }
  const rest = args.slice(2);

  const unknown = rest.filter((arg) => arg.startsWith("--") && !KNOWN_FLAGS.has(arg));
  if (unknown.length > 0) return usage(cli, `unknown option(s): ${unknown.join(", ")}`);

  const repoRoot = flagValue(rest, "--repo-root");
  const result = flagValue(rest, "--result");
  const ticketTitle = flagValue(rest, "--ticket-title");
  const checkpointBase = flagValue(rest, "--checkpoint-base");
  const checkpointHead = flagValue(rest, "--checkpoint-head");
  const guardResult = flagValue(rest, "--guard-result");
  const guardExitRaw = flagValue(rest, "--guard-exit");
  // Effective-gate flags are now OPTIONAL cross-checks. The authoritative gate
  // is sourced from the active-ticket (Core file → Core file). If any of these
  // are supplied they must equal the active-ticket gate, else
  // GATE_PROVENANCE_MISMATCH. There is no flag fallback — pure-strict.
  const gateDeclared = flagValue(rest, "--gate-declared");
  const gateEffective = flagValue(rest, "--gate-effective");
  const gateHumanRequiredRaw = flagValue(rest, "--gate-human-required");

  if (
    repoRoot === undefined ||
    result === undefined ||
    ticketTitle === undefined ||
    checkpointBase === undefined ||
    checkpointHead === undefined ||
    guardResult === undefined ||
    guardExitRaw === undefined
  ) {
    return usage(
      cli,
      "run-report write requires --repo-root, --result, --ticket-title, --checkpoint-base, --checkpoint-head, --guard-result, --guard-exit",
    );
  }

  if (result !== "PASS" && result !== "ESCALATE") {
    return usage(cli, `--result must be PASS or ESCALATE; got ${JSON.stringify(result)}`);
  }
  const guardExit = Number.parseInt(guardExitRaw, 10);
  if (!Number.isInteger(guardExit)) {
    return usage(cli, `--guard-exit must be an integer; got ${JSON.stringify(guardExitRaw)}`);
  }
  // When supplied, --gate-human-required must still be a well-formed boolean
  // before it can be used as a cross-check value.
  if (
    gateHumanRequiredRaw !== undefined &&
    gateHumanRequiredRaw !== "true" &&
    gateHumanRequiredRaw !== "false"
  ) {
    return usage(
      cli,
      `--gate-human-required must be true or false; got ${JSON.stringify(gateHumanRequiredRaw)}`,
    );
  }

  // Per-role agent-output-source flags are optional. Each, when supplied, must
  // be a valid enum value; an invalid value is a usage error (exit 2), never a
  // silent coerce/drop. The metadata is undefined when no flag is supplied so
  // the report omits the field (backward-compatible write).
  const agentOutputSource = collectAgentOutputSource(rest);
  if (!agentOutputSource.ok) {
    return usage(cli, agentOutputSource.detail);
  }

  const forgeDir = joinForge(epicPath);
  const inputs = {
    engineer: flagValue(rest, "--engineer-output") ?? join(forgeDir, "engineer-output.yaml"),
    semantic: flagValue(rest, "--semantic-output") ?? join(forgeDir, "semantic-verifier-output.yaml"),
    scope: flagValue(rest, "--scope-output") ?? join(forgeDir, "scope-verifier-output.yaml"),
    pm: flagValue(rest, "--pm-output") ?? join(forgeDir, "pm-output.yaml"),
    facts: flagValue(rest, "--facts") ?? join(forgeDir, "orchestrator-facts.json"),
    activeTicket: flagValue(rest, "--active-ticket") ?? join(forgeDir, "active-ticket.json"),
  };
  const outPath = flagValue(rest, "--out") ?? join(forgeDir, "run-report.json");

  // Hard fence: writes only ever go into <epic>/.forge/. This mirrors the
  // orchestrator's v1 hard constraint that the only runtime-state writes are
  // gitignored .forge/ files. Uses resolved-path containment so a crafted
  // `<epic>/.forge/../../outside.json` cannot escape via string-prefix bypass.
  if (!isInsideForgeDir(outPath, forgeDir)) {
    return fail(cli, "OUT_PATH_OUTSIDE_FORGE", [
      `--out must resolve to a path strictly inside ${forgeDir}/; got ${outPath}`,
    ]);
  }

  // Load + parse every input through the seam. A missing file is MISSING_INPUT
  // (orchestrator forgot a step), not a crash.
  const engineerRaw = io.readFileIfExists(inputs.engineer);
  if (engineerRaw === null) return fail(cli, "MISSING_INPUT", [`engineer output not found: ${inputs.engineer}`]);
  const engineerParsed = parseAgentOutput("engineer", engineerRaw);
  if (!engineerParsed.ok) return fail(cli, "AGENT_OUTPUT_INVALID", engineerParsed.errors, "engineer");

  const semanticRaw = io.readFileIfExists(inputs.semantic);
  if (semanticRaw === null) return fail(cli, "MISSING_INPUT", [`semantic-verifier output not found: ${inputs.semantic}`]);
  const semanticParsed = parseAgentOutput("semantic-verifier", semanticRaw);
  if (!semanticParsed.ok) return fail(cli, "AGENT_OUTPUT_INVALID", semanticParsed.errors, "semantic-verifier");

  const scopeRaw = io.readFileIfExists(inputs.scope);
  if (scopeRaw === null) return fail(cli, "MISSING_INPUT", [`scope-verifier output not found: ${inputs.scope}`]);
  const scopeParsed = parseAgentOutput("scope-verifier", scopeRaw);
  if (!scopeParsed.ok) return fail(cli, "AGENT_OUTPUT_INVALID", scopeParsed.errors, "scope-verifier");

  const pmRaw = io.readFileIfExists(inputs.pm);
  if (pmRaw === null) return fail(cli, "MISSING_INPUT", [`pm output not found: ${inputs.pm}`]);
  const pmParsed = parseAgentOutput("pm", pmRaw);
  if (!pmParsed.ok) return fail(cli, "AGENT_OUTPUT_INVALID", pmParsed.errors, "pm");

  const factsRaw = io.readFileIfExists(inputs.facts);
  if (factsRaw === null) return fail(cli, "MISSING_INPUT", [`orchestrator-facts not found: ${inputs.facts}`]);
  let factsJson: unknown;
  try {
    factsJson = JSON.parse(factsRaw);
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return fail(cli, "FACTS_INVALID", [`malformed JSON: ${message}`]);
  }
  const factsParsed = OrchestratorConfirmedFactsSchema.safeParse(factsJson);
  if (!factsParsed.success) {
    return fail(cli, "FACTS_INVALID", describeIssues(factsParsed.error));
  }

  const activeRaw = io.readFileIfExists(inputs.activeTicket);
  if (activeRaw === null) {
    return fail(cli, "MISSING_INPUT", [`active-ticket not found: ${inputs.activeTicket}`]);
  }
  const activeParsed = parseActiveTicket(activeRaw);
  if (!activeParsed.ok) {
    return fail(cli, "ACTIVE_TICKET_INVALID", [activeParsed.message]);
  }

  // The active-ticket is the single source of truth for the effective gate
  // (Core file → Core file). Pure-strict: there is no flag fallback. An
  // active-ticket without a gate is a hard failure, not a silently-defaulted
  // run — this closes the gate-provenance seam under both the Markdown fallback
  // and the future workflow-backed runner.
  const sourcedGate = activeParsed.ticket.gate;
  if (sourcedGate === undefined) {
    return fail(cli, "GATE_SOURCE_MISSING", [
      `active-ticket has no gate; the effective gate must be sourced from ${inputs.activeTicket}`,
    ]);
  }

  // The --gate-* flags are optional cross-checks only. When supplied they must
  // equal the active-ticket gate; any disagreement is GATE_PROVENANCE_MISMATCH.
  // This keeps the orchestrator's flags honest without letting them override the
  // Core-sourced gate (which would re-open the provenance seam, and would make
  // HUMAN_GATE_MISMATCH tautological).
  const provenanceMismatches: string[] = [];
  if (gateDeclared !== undefined && gateDeclared !== sourcedGate.declared) {
    provenanceMismatches.push(
      `--gate-declared=${gateDeclared} disagrees with active-ticket gate.declared=${sourcedGate.declared}`,
    );
  }
  if (gateEffective !== undefined && gateEffective !== sourcedGate.effective) {
    provenanceMismatches.push(
      `--gate-effective=${gateEffective} disagrees with active-ticket gate.effective=${sourcedGate.effective}`,
    );
  }
  if (gateHumanRequiredRaw !== undefined && (gateHumanRequiredRaw === "true") !== sourcedGate.human_required) {
    provenanceMismatches.push(
      `--gate-human-required=${gateHumanRequiredRaw} disagrees with active-ticket gate.human_required=${sourcedGate.human_required}`,
    );
  }
  if (provenanceMismatches.length > 0) {
    return fail(cli, "GATE_PROVENANCE_MISMATCH", provenanceMismatches);
  }

  const commitGate = collectCommitGateMaterials(rest);
  const notes = collectNotes(rest);
  const runtime: RuntimeMetadata = {
    result,
    ticket_title: ticketTitle,
    effective_gate: {
      declared: sourcedGate.declared,
      effective: sourcedGate.effective,
      human_required: sourcedGate.human_required,
    },
    checkpoint: { base: checkpointBase, head: checkpointHead },
    guard: { result: guardResult, exit: guardExit },
    ...(commitGate !== undefined ? { commit_gate_materials: commitGate } : {}),
    ...(agentOutputSource.value !== undefined
      ? { agent_output_source: agentOutputSource.value }
      : {}),
    ...(notes !== undefined ? { notes } : {}),
  };

  const assemble: AssembleInputs = {
    engineer: engineerParsed.data,
    semantic: semanticParsed.data,
    scope: scopeParsed.data,
    pm: pmParsed.data,
    facts: factsParsed.data,
    activeTicket: activeParsed.ticket,
    runtime,
  };

  const assembled = assembleRunReport(assemble);
  if (!assembled.ok) {
    return fail(cli, assembled.code, assembled.errors);
  }

  // Deterministic serialization: 2-space indent, key order pinned by the
  // declaration order in the schema, trailing newline. Two runs over identical
  // inputs produce byte-identical files.
  const serialized = `${JSON.stringify(assembled.report, null, 2)}\n`;
  io.writeFile(outPath, serialized);
  return 0;
}

function fail(cli: CliIo, code: FailureCode, errors: string[], source?: string): number {
  cli.print(JSON.stringify({ ok: false, code, ...(source !== undefined ? { source } : {}), errors }, null, 2));
  return 1;
}

function usage(cli: CliIo, detail: string): number {
  cli.printError(detail);
  cli.printError(USAGE);
  return 2;
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined) return undefined;
  // Allow `-` or any non-flag string, including absolute paths that start with
  // `D:` etc. The orchestrator quotes its values so `--` literals do not leak.
  if (value.startsWith("--")) return undefined;
  return value;
}

function collectAll(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag) {
      const v = args[i + 1];
      if (v !== undefined && !v.startsWith("--")) values.push(v);
    }
  }
  return values;
}

function collectNotes(args: string[]): string[] | undefined {
  const notes = collectAll(args, "--note");
  return notes.length > 0 ? notes : undefined;
}

function collectCommitGateMaterials(
  args: string[],
): RuntimeMetadata["commit_gate_materials"] | undefined {
  const proposed = flagValue(args, "--proposed-status-transition");
  const message = flagValue(args, "--suggested-commit-message");
  const commands = collectAll(args, "--suggested-command");
  if (proposed === undefined && message === undefined && commands.length === 0) return undefined;
  if (proposed === undefined || message === undefined) {
    // Partial commit-gate materials are intentionally rejected by leaving the
    // field absent; the orchestrator only emits all three together at the PASS
    // commit gate. If any of these are missing in practice the orchestrator
    // surfaced a different error upstream.
    return undefined;
  }
  return {
    proposed_status_transition: proposed,
    suggested_commit_message: message,
    suggested_commands: commands,
  };
}

type AgentOutputSourceMetadata = NonNullable<RuntimeMetadata["agent_output_source"]>;

/**
 * Build the optional `agent_output_source` metadata from whichever per-role
 * flags are present. Returns `{ ok: true, value: undefined }` when no flag is
 * supplied (the report omits the field). An invalid enum value on any flag is a
 * usage error (`{ ok: false, detail }`), never a coerce or silent drop.
 */
function collectAgentOutputSource(
  args: string[],
):
  | { ok: true; value: AgentOutputSourceMetadata | undefined }
  | { ok: false; detail: string } {
  const metadata: AgentOutputSourceMetadata = {};
  let any = false;
  for (const [flag, role] of Object.entries(AGENT_OUTPUT_SOURCE_FLAGS)) {
    const raw = flagValue(args, flag);
    if (raw === undefined) continue;
    if (!isAgentOutputSourceValue(raw)) {
      return {
        ok: false,
        detail: `${flag} must be one of ${AGENT_OUTPUT_SOURCE_VALUES.join("|")}; got ${JSON.stringify(raw)}`,
      };
    }
    metadata[role] = raw;
    any = true;
  }
  return { ok: true, value: any ? metadata : undefined };
}

function isAgentOutputSourceValue(value: string): value is AgentOutputSourceValue {
  return (AGENT_OUTPUT_SOURCE_VALUES as readonly string[]).includes(value);
}

function describeIssues(error: { issues: { path: (string | number)[]; message: string }[] }): string[] {
  return error.issues.map((issue) => {
    const at = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${at}${issue.message}`;
  });
}

function joinForge(epic: string): string {
  return normalize(`${epic.replace(/[\\/]+$/, "")}/.forge`);
}

function join(dir: string, name: string): string {
  return normalize(`${dir.replace(/[\\/]+$/, "")}/${name}`);
}

function normalize(value: string): string {
  return value.replace(/\\/g, "/");
}

function isInsideForgeDir(outPath: string, forgeDir: string): boolean {
  // Resolved-path containment. A simple string-prefix check passes for crafted
  // paths like `<forgeDir>/../../outside.json` (which starts with `<forgeDir>/`
  // as a string but escapes the directory on resolution); using
  // `path.relative` over resolved paths reduces that to a `..`-prefixed
  // relative path that we reject.
  const resolvedOut = path.resolve(outPath);
  const resolvedDir = path.resolve(forgeDir);
  if (resolvedOut === resolvedDir) return false; // writing the dir itself, not a file inside
  const relative = path.relative(resolvedDir, resolvedOut);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isErrno(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
