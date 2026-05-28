import * as path from "node:path";

import { describe, expect, test } from "vitest";

import type { CliIo } from "../cli/run.js";

import { runWriteRunReport, type RunReportIo } from "./cli.js";

const EPIC = "/epic/forge-example";
const FORGE = path.posix.join(EPIC, ".forge");

const ENGINEER_YAML = [
  "ticket: T01",
  "summary: add helper",
  "files_changed: [{ path: src/sandbox/add.ts, adds: 3, dels: 0 }]",
  "tests: { added: 2, changed: 0 }",
  "commands_run: [{ cmd: pnpm test, result: pass }]",
  "within_allowed_paths: true",
  "",
].join("\n");

const SEMANTIC_YAML = [
  "verdict: APPROVE",
  'acceptance_checked: [{ id: 1, status: met, evidence: "add.ts:1" }]',
  "findings: []",
  "risk_level: low",
  "",
].join("\n");

const SCOPE_YAML = [
  "verdict: APPROVE",
  "changed_files: [src/sandbox/add.ts]",
  "allowed_path_status: clean",
  "forbidden_path_violations: []",
  "unexpected_files: []",
  "recommendation: in scope",
  "",
].join("\n");

const PM_YAML = [
  "decision: PASS",
  "rationale: green",
  "decision_id: D-001",
  "journal_entry: T01 PASS",
  "human_gate_required: true",
  "",
].join("\n");

const FACTS_JSON = JSON.stringify({
  parse_validation: { engineer: true, semantic_verifier: true, scope_verifier: true },
  verify_command_results: [{ cmd: "pnpm test", result: "pass" }],
  final_changed_files: ["src/sandbox/add.ts"],
  final_branch_status: { branch: "forge/example/T01-add", ahead_of_base: 0, committed: false },
});

const ACTIVE_TICKET_JSON = JSON.stringify({
  schema: "forge-active-ticket/v1",
  repo_root: "/repo",
  epic_path: EPIC,
  ticket: "T01",
  branch: "forge/example/T01-add",
  allowed_paths: ["src/sandbox/**"],
  forbidden_paths: ["package.json"],
  protected_paths: ["**/manifest.yaml"],
});

const defaultPaths = {
  engineer: path.posix.join(FORGE, "engineer-output.yaml"),
  semantic: path.posix.join(FORGE, "semantic-verifier-output.yaml"),
  scope: path.posix.join(FORGE, "scope-verifier-output.yaml"),
  pm: path.posix.join(FORGE, "pm-output.yaml"),
  facts: path.posix.join(FORGE, "orchestrator-facts.json"),
  activeTicket: path.posix.join(FORGE, "active-ticket.json"),
  outDefault: path.posix.join(FORGE, "run-report.json"),
};

function defaultFs(): Record<string, string> {
  return {
    [defaultPaths.engineer]: ENGINEER_YAML,
    [defaultPaths.semantic]: SEMANTIC_YAML,
    [defaultPaths.scope]: SCOPE_YAML,
    [defaultPaths.pm]: PM_YAML,
    [defaultPaths.facts]: FACTS_JSON,
    [defaultPaths.activeTicket]: ACTIVE_TICKET_JSON,
  };
}

function makeIo(fsState: Record<string, string> = defaultFs()): {
  cli: CliIo;
  out: string[];
  err: string[];
  reportIo: RunReportIo;
  writes: { file: string; contents: string }[];
  state: Record<string, string>;
} {
  const out: string[] = [];
  const err: string[] = [];
  const writes: { file: string; contents: string }[] = [];
  const state: Record<string, string> = { ...fsState };

  return {
    cli: {
      print: (text) => out.push(text),
      printError: (text) => err.push(text),
      writeArtifact: () => {
        throw new Error("run-report CLI must never use writeArtifact");
      },
    },
    out,
    err,
    state,
    writes,
    reportIo: {
      readFileIfExists: (file) => {
        const normalized = file.replace(/\\/g, "/");
        if (!Object.prototype.hasOwnProperty.call(state, normalized)) return null;
        return state[normalized] ?? null;
      },
      writeFile: (file, contents) => {
        const normalized = file.replace(/\\/g, "/");
        writes.push({ file: normalized, contents });
        state[normalized] = contents;
      },
    },
  };
}

const baseArgs = [
  "write",
  EPIC,
  "--repo-root",
  "/repo",
  "--result",
  "PASS",
  "--ticket-title",
  "Add helper",
  "--checkpoint-base",
  "abc123",
  "--checkpoint-head",
  "abc123",
  "--guard-result",
  "OK",
  "--guard-exit",
  "0",
  // Authoritative gate flags from the orchestrator's Core-derived dry-run/packets state.
  // Matches PM_YAML's human_gate_required: true; mismatches surface as HUMAN_GATE_MISMATCH.
  "--gate-declared",
  "pr",
  "--gate-effective",
  "pr",
  "--gate-human-required",
  "true",
];

describe("forge run-report write — default paths", () => {
  test("happy path writes <epic>/.forge/run-report.json with a valid v1 report", () => {
    const { cli, reportIo, writes, state } = makeIo();
    const code = runWriteRunReport(baseArgs, cli, reportIo);

    expect(code).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.file).toBe(defaultPaths.outDefault);
    const parsed = JSON.parse(state[defaultPaths.outDefault] ?? "") as {
      schema: string;
      result: string;
      decision_id: string;
    };
    expect(parsed.schema).toBe("forge-run-report/v1");
    expect(parsed.result).toBe("PASS");
    expect(parsed.decision_id).toBe("D-001");
  });

  test("explicit --out overrides the default filename within <epic>/.forge/", () => {
    const { cli, reportIo, writes } = makeIo();
    // The writer fences --out inside <epic>/.forge/ but allows alternate
    // filenames there (e.g. for tests or per-run scratch outputs).
    const customOut = path.posix.join(FORGE, "run-report.alt.json");
    const code = runWriteRunReport([...baseArgs, "--out", customOut], cli, reportIo);

    expect(code).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.file).toBe(customOut);
  });
});

describe("forge run-report write — error surfaces", () => {
  test("missing required flag surfaces a usage error (exit 2)", () => {
    const { cli, reportIo, err } = makeIo();
    const code = runWriteRunReport(["write", EPIC], cli, reportIo);
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/usage|required/i);
  });

  test("invalid agent output → AGENT_OUTPUT_INVALID exit 1", () => {
    const fs = defaultFs();
    fs[defaultPaths.engineer] = "summary: only summary\n";
    const { cli, reportIo, out } = makeIo(fs);

    const code = runWriteRunReport(baseArgs, cli, reportIo);
    expect(code).toBe(1);
    const parsed = JSON.parse(out.join("\n")) as { code: string };
    expect(parsed.code).toBe("AGENT_OUTPUT_INVALID");
  });

  test("invalid facts → FACTS_INVALID exit 1", () => {
    const fs = defaultFs();
    fs[defaultPaths.facts] = JSON.stringify({ parse_validation: {} });
    const { cli, reportIo, out } = makeIo(fs);

    const code = runWriteRunReport(baseArgs, cli, reportIo);
    expect(code).toBe(1);
    const parsed = JSON.parse(out.join("\n")) as { code: string };
    expect(parsed.code).toBe("FACTS_INVALID");
  });

  test("invalid active-ticket → ACTIVE_TICKET_INVALID exit 1", () => {
    const fs = defaultFs();
    fs[defaultPaths.activeTicket] = JSON.stringify({ schema: "forge-active-ticket/v1" }); // missing required
    const { cli, reportIo, out } = makeIo(fs);

    const code = runWriteRunReport(baseArgs, cli, reportIo);
    expect(code).toBe(1);
    const parsed = JSON.parse(out.join("\n")) as { code: string };
    expect(parsed.code).toBe("ACTIVE_TICKET_INVALID");
  });

  test("missing required input file → MISSING_INPUT exit 1", () => {
    const fs = defaultFs();
    delete fs[defaultPaths.engineer];
    const { cli, reportIo, out } = makeIo(fs);

    const code = runWriteRunReport(baseArgs, cli, reportIo);
    expect(code).toBe(1);
    const parsed = JSON.parse(out.join("\n")) as { code: string };
    expect(parsed.code).toBe("MISSING_INPUT");
  });

  test("PASS over a REJECT verifier → RESULT_REQUIRES_GREEN exit 1", () => {
    const fs = defaultFs();
    fs[defaultPaths.semantic] = SEMANTIC_YAML.replace("verdict: APPROVE", "verdict: REJECT");
    const { cli, reportIo, out } = makeIo(fs);

    const code = runWriteRunReport(baseArgs, cli, reportIo);
    expect(code).toBe(1);
    const parsed = JSON.parse(out.join("\n")) as { code: string };
    expect(parsed.code).toBe("RESULT_REQUIRES_GREEN");
  });
});

describe("forge run-report write — determinism", () => {
  test("two runs over identical inputs produce byte-identical output", () => {
    const { cli: cli1, reportIo: io1, state: state1 } = makeIo();
    const { cli: cli2, reportIo: io2, state: state2 } = makeIo();

    const code1 = runWriteRunReport(baseArgs, cli1, io1);
    const code2 = runWriteRunReport(baseArgs, cli2, io2);

    expect(code1).toBe(0);
    expect(code2).toBe(0);
    expect(state1[defaultPaths.outDefault]).toBe(state2[defaultPaths.outDefault]);
  });

  test("output ends with a trailing newline and uses 2-space indent", () => {
    const { cli, reportIo, state } = makeIo();
    runWriteRunReport(baseArgs, cli, reportIo);
    const contents = state[defaultPaths.outDefault] ?? "";
    expect(contents.endsWith("\n")).toBe(true);
    // 2-space indent — the second line should start with two spaces.
    const lines = contents.split("\n");
    expect(lines[1]?.startsWith("  ")).toBe(true);
    expect(lines[1]?.startsWith("   ")).toBe(false); // not 3+ spaces
  });
});

describe("forge run-report write — safety: only writes the single artifact", () => {
  test("the IO seam observes exactly one write, to <epic>/.forge/run-report.json", () => {
    const { cli, reportIo, writes } = makeIo();
    runWriteRunReport(baseArgs, cli, reportIo);

    expect(writes).toHaveLength(1);
    expect(writes[0]?.file).toBe(defaultPaths.outDefault);
    // Specifically: nothing under JOURNAL.md, DECISIONS.md, the ticket file,
    // the manifest, or anywhere in docs/governance/.
    for (const write of writes) {
      expect(write.file).not.toMatch(/JOURNAL\.md$/);
      expect(write.file).not.toMatch(/DECISIONS\.md$/);
      expect(write.file).not.toMatch(/manifest\.yaml$/);
      expect(write.file).not.toMatch(/docs\/governance\//);
      expect(write.file).not.toMatch(/\.md$/); // no markdown writes at all
    }
  });

  test("a custom --out outside <epic>/.forge/ is rejected (exit 1, OUT_PATH_OUTSIDE_FORGE)", () => {
    const { cli, reportIo, out } = makeIo();
    const code = runWriteRunReport(
      [...baseArgs, "--out", "/somewhere/else/report.json"],
      cli,
      reportIo,
    );
    expect(code).toBe(1);
    const parsed = JSON.parse(out.join("\n")) as { code: string };
    expect(parsed.code).toBe("OUT_PATH_OUTSIDE_FORGE");
  });

  test("--out with `..` traversal is rejected (exit 1, OUT_PATH_OUTSIDE_FORGE) — resolved-path containment", () => {
    const { cli, reportIo, out, writes } = makeIo();
    // String prefix check passes (it does start with `<FORGE>/`), but the
    // resolved path escapes the .forge directory. The fix must catch this.
    const traversalOut = path.posix.join(FORGE, "..", "..", "outside.json");
    const code = runWriteRunReport([...baseArgs, "--out", traversalOut], cli, reportIo);
    expect(code).toBe(1);
    const parsed = JSON.parse(out.join("\n")) as { code: string };
    expect(parsed.code).toBe("OUT_PATH_OUTSIDE_FORGE");
    expect(writes).toEqual([]); // no write to any path
  });

  test("--out equal to the .forge directory itself is rejected (cannot write a file at the dir path)", () => {
    const { cli, reportIo, out } = makeIo();
    const code = runWriteRunReport([...baseArgs, "--out", FORGE], cli, reportIo);
    expect(code).toBe(1);
    const parsed = JSON.parse(out.join("\n")) as { code: string };
    expect(parsed.code).toBe("OUT_PATH_OUTSIDE_FORGE");
  });
});

describe("forge run-report write — ESCALATE result", () => {
  test("ESCALATE accepted with non-green inputs and notes propagated", () => {
    const fs = defaultFs();
    fs[defaultPaths.semantic] = SEMANTIC_YAML.replace("verdict: APPROVE", "verdict: REJECT");
    fs[defaultPaths.pm] = [
      "decision: ESCALATE",
      "rationale: verifier rejected",
      "decision_id: D-001",
      "journal_entry: T01 escalated",
      "human_gate_required: true",
      "",
    ].join("\n");

    const args = [
      "write",
      EPIC,
      "--repo-root",
      "/repo",
      "--result",
      "ESCALATE",
      "--ticket-title",
      "Add helper",
      "--checkpoint-base",
      "abc123",
      "--checkpoint-head",
      "abc123",
      "--guard-result",
      "OK",
      "--guard-exit",
      "0",
      "--gate-declared",
      "pr",
      "--gate-effective",
      "pr",
      "--gate-human-required",
      "true",
      "--note",
      "verifier REJECT, escalating per PM",
    ];
    const { cli, reportIo, state } = makeIo(fs);
    const code = runWriteRunReport(args, cli, reportIo);

    expect(code).toBe(0);
    const parsed = JSON.parse(state[defaultPaths.outDefault] ?? "") as {
      result: string;
      notes?: string[];
    };
    expect(parsed.result).toBe("ESCALATE");
    expect(parsed.notes).toEqual(["verifier REJECT, escalating per PM"]);
  });
});

describe("forge run-report write — authoritative gate cross-check (HUMAN_GATE_MISMATCH)", () => {
  // The assembler check is real only when the CLI takes the gate from the
  // orchestrator (not from the PM output). These tests prove the cross-check
  // is reachable through the CLI, not just through the assembler unit tests.

  test("PM emits human_gate_required:false but --gate-human-required true → HUMAN_GATE_MISMATCH (exit 1)", () => {
    const fs = defaultFs();
    fs[defaultPaths.pm] = PM_YAML.replace("human_gate_required: true", "human_gate_required: false");
    const { cli, reportIo, out, writes } = makeIo(fs);
    // baseArgs pins --gate-human-required true; PM disagrees.
    const code = runWriteRunReport(baseArgs, cli, reportIo);
    expect(code).toBe(1);
    const parsed = JSON.parse(out.join("\n")) as { code: string };
    expect(parsed.code).toBe("HUMAN_GATE_MISMATCH");
    expect(writes).toEqual([]); // mismatch must not produce a written report
  });

  test("PM emits human_gate_required:true but --gate-human-required false → HUMAN_GATE_MISMATCH (exit 1)", () => {
    // Symmetric direction: PM says human-required, orchestrator says not.
    const argsWithFalseGate = baseArgs.map((arg, index) => {
      if (index > 0 && baseArgs[index - 1] === "--gate-human-required") return "false";
      return arg;
    });
    const { cli, reportIo, out } = makeIo();
    const code = runWriteRunReport(argsWithFalseGate, cli, reportIo);
    expect(code).toBe(1);
    const parsed = JSON.parse(out.join("\n")) as { code: string };
    expect(parsed.code).toBe("HUMAN_GATE_MISMATCH");
  });

  test("matching authoritative gate and PM emission → success", () => {
    // The default test path: PM_YAML says human_gate_required:true and
    // baseArgs says --gate-human-required true. The cross-check must NOT
    // fire and a report must be written.
    const { cli, reportIo, writes } = makeIo();
    const code = runWriteRunReport(baseArgs, cli, reportIo);
    expect(code).toBe(0);
    expect(writes).toHaveLength(1);
  });
});

describe("forge run-report write — gate flag validation", () => {
  test("missing --gate-human-required surfaces a usage error (exit 2)", () => {
    const argsWithoutGateHR = baseArgs.filter((arg, index) => {
      if (arg === "--gate-human-required") return false;
      if (index > 0 && baseArgs[index - 1] === "--gate-human-required") return false;
      return true;
    });
    const { cli, reportIo, err } = makeIo();
    const code = runWriteRunReport(argsWithoutGateHR, cli, reportIo);
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/gate-human-required|gate/i);
  });

  test("missing --gate-declared surfaces a usage error (exit 2)", () => {
    const argsWithoutGateDeclared = baseArgs.filter((arg, index) => {
      if (arg === "--gate-declared") return false;
      if (index > 0 && baseArgs[index - 1] === "--gate-declared") return false;
      return true;
    });
    const { cli, reportIo, err } = makeIo();
    const code = runWriteRunReport(argsWithoutGateDeclared, cli, reportIo);
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/gate-declared|gate/i);
  });

  test("--gate-human-required other than true|false surfaces a usage error (exit 2)", () => {
    const argsWithBadGate = baseArgs.map((arg, index) => {
      if (index > 0 && baseArgs[index - 1] === "--gate-human-required") return "maybe";
      return arg;
    });
    const { cli, reportIo, err } = makeIo();
    const code = runWriteRunReport(argsWithBadGate, cli, reportIo);
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/true|false/i);
  });
});

describe("forge run-report write — commit-gate materials", () => {
  test("flags propagate into commit_gate_materials", () => {
    const { cli, reportIo, state } = makeIo();
    const args = [
      ...baseArgs,
      "--proposed-status-transition",
      "T01: pending -> ready_for_pr (proposed)",
      "--suggested-commit-message",
      "feat: add helper",
      "--suggested-command",
      "git add src/sandbox/add.ts",
      "--suggested-command",
      "git commit -m \"feat: add helper\"",
    ];
    const code = runWriteRunReport(args, cli, reportIo);

    expect(code).toBe(0);
    const parsed = JSON.parse(state[defaultPaths.outDefault] ?? "") as {
      commit_gate_materials?: {
        proposed_status_transition: string;
        suggested_commit_message: string;
        suggested_commands: string[];
      };
    };
    expect(parsed.commit_gate_materials?.proposed_status_transition).toContain("T01");
    expect(parsed.commit_gate_materials?.suggested_commit_message).toBe("feat: add helper");
    expect(parsed.commit_gate_materials?.suggested_commands).toEqual([
      "git add src/sandbox/add.ts",
      'git commit -m "feat: add helper"',
    ]);
  });
});
