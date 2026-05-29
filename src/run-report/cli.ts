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
  "         --gate-declared <none|pr|merge|phase|manual>\n" +
  "         --gate-effective <none|pr|merge|phase|manual>\n" +
  "         --gate-human-required <true|false>\n" +
  "         [--engineer-output <path>] [--semantic-output <path>] [--scope-output <path>]\n" +
  "         [--pm-output <path>] [--facts <path>] [--active-ticket <path>]\n" +
  "         [--out <path>]\n" +
  "         [--proposed-status-transition <s>] [--suggested-commit-message <s>]\n" +
  "         [--suggested-command <s>] [--note <s>]";

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
]);

type FailureCode =
  | "MISSING_INPUT"
  | "AGENT_OUTPUT_INVALID"
  | "FACTS_INVALID"
  | "ACTIVE_TICKET_INVALID"
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
  // Authoritative effective-gate flags supplied by the orchestrator from the
  // Core-derived dry-run/packets state. The assembler's HUMAN_GATE_MISMATCH
  // check compares pm-output's `human_gate_required` against the value pinned
  // here; deriving it from the PM output itself would make the check
  // tautological.
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
    guardExitRaw === undefined ||
    gateDeclared === undefined ||
    gateEffective === undefined ||
    gateHumanRequiredRaw === undefined
  ) {
    return usage(
      cli,
      "run-report write requires --repo-root, --result, --ticket-title, --checkpoint-base, --checkpoint-head, --guard-result, --guard-exit, --gate-declared, --gate-effective, --gate-human-required",
    );
  }

  if (result !== "PASS" && result !== "ESCALATE") {
    return usage(cli, `--result must be PASS or ESCALATE; got ${JSON.stringify(result)}`);
  }
  const guardExit = Number.parseInt(guardExitRaw, 10);
  if (!Number.isInteger(guardExit)) {
    return usage(cli, `--guard-exit must be an integer; got ${JSON.stringify(guardExitRaw)}`);
  }
  if (gateHumanRequiredRaw !== "true" && gateHumanRequiredRaw !== "false") {
    return usage(
      cli,
      `--gate-human-required must be true or false; got ${JSON.stringify(gateHumanRequiredRaw)}`,
    );
  }
  const gateHumanRequired = gateHumanRequiredRaw === "true";

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

  // Effective-gate cross-check input: the orchestrator supplies the
  // authoritative gate (Core-derived from the active run / packets / dry-run),
  // and the assembler verifies the PM emission's `human_gate_required` matches
  // it. Deriving the gate from the PM output here would make
  // `HUMAN_GATE_MISMATCH` tautological — see the engineer-flagged risk noted
  // in PR #6's review.
  const commitGate = collectCommitGateMaterials(rest);
  const notes = collectNotes(rest);
  const runtime: RuntimeMetadata = {
    result,
    ticket_title: ticketTitle,
    effective_gate: {
      declared: gateDeclared,
      effective: gateEffective,
      human_required: gateHumanRequired,
    },
    checkpoint: { base: checkpointBase, head: checkpointHead },
    guard: { result: guardResult, exit: guardExit },
    ...(commitGate !== undefined ? { commit_gate_materials: commitGate } : {}),
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
