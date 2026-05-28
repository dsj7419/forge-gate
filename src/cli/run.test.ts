import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

import type { ValidationReport } from "../validate/findings.js";
import { ActiveTicketSchema } from "../guard/active-ticket.js";
import { runGuardPaths, type GuardEnv } from "../guard/cli.js";
import type { RunReportIo } from "../run-report/cli.js";
import { runCli, type CliIo } from "./run.js";

const cliTempDirs: string[] = [];
afterEach(() => {
  for (const dir of cliTempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "validate", "__fixtures__");
const fx = (name: string): string => path.join(fixturesDir, name);

function fakeIo(): {
  io: CliIo;
  out: string[];
  err: string[];
  artifacts: { epicPath: string; report: ValidationReport }[];
} {
  const out: string[] = [];
  const err: string[] = [];
  const artifacts: { epicPath: string; report: ValidationReport }[] = [];
  return {
    io: {
      print: (text) => out.push(text),
      printError: (text) => err.push(text),
      writeArtifact: (epicPath, report) => artifacts.push({ epicPath, report }),
    },
    out,
    err,
    artifacts,
  };
}

describe("runCli validate", () => {
  test("exits 0 and writes the artifact for a clean epic", () => {
    const { io, out, artifacts } = fakeIo();
    const code = runCli(["validate", fx("valid-epic")], io);

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("OK");
    expect(artifacts).toHaveLength(1);
  });

  test("exits non-zero and still writes the artifact for a missing epic", () => {
    const { io, out, artifacts } = fakeIo();
    const code = runCli(["validate", fx("no-epic")], io);

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("EPIC_FILE_MISSING");
    expect(artifacts).toHaveLength(1);
  });

  test("exits non-zero for an execution-unready epic", () => {
    const { io, out } = fakeIo();
    const code = runCli(["validate", fx("unready-epic")], io);

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("VERIFY_COMMANDS_REQUIRED");
  });

  test("--json prints the report as JSON and writes no artifact", () => {
    const { io, out, artifacts } = fakeIo();
    const code = runCli(["validate", fx("valid-epic"), "--json"], io);

    expect(code).toBe(0);
    expect(artifacts).toHaveLength(0);
    const parsed = JSON.parse(out.join("\n")) as ValidationReport;
    expect(parsed.ok).toBe(true);
  });

  test("exits 2 with usage when the epic path is missing", () => {
    const { io, err } = fakeIo();
    const code = runCli(["validate"], io);

    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/usage/i);
  });

  test("rejects an unknown flag with usage (exit 2)", () => {
    const { io, err, artifacts } = fakeIo();
    const code = runCli(["validate", fx("valid-epic"), "--wat"], io);

    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/usage/i);
    expect(artifacts).toHaveLength(0);
  });

  test("treats a flag in the path position as a missing path (exit 2)", () => {
    const { io } = fakeIo();
    expect(runCli(["validate", "--json"], io)).toBe(2);
  });

  test("returns a controlled exit 1 when the artifact write fails", () => {
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIo = {
      print: (text) => out.push(text),
      printError: (text) => err.push(text),
      writeArtifact: () => {
        throw new Error("EROFS: read-only file system");
      },
    };
    const code = runCli(["validate", fx("valid-epic")], io);

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("OK"); // validation still ran and printed
    expect(err.join("\n")).toMatch(/validation-report\.json failed/i);
  });
});

describe("runCli status flag handling", () => {
  test("rejects status --json for v1 (exit 2)", () => {
    const { io, err } = fakeIo();
    const code = runCli(["status", fx("valid-epic"), "--json"], io);

    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/usage/i);
  });

  test("rejects an unknown status flag (exit 2)", () => {
    const { io } = fakeIo();
    expect(runCli(["status", fx("valid-epic"), "--wat"], io)).toBe(2);
  });
});

describe("runCli status", () => {
  test("summarizes a loadable epic and exits 0", () => {
    const { io, out } = fakeIo();
    const code = runCli(["status", fx("valid-epic")], io);

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("demo-epic");
  });

  test("exits non-zero only when the contract cannot load at all", () => {
    const { io } = fakeIo();
    expect(runCli(["status", fx("no-epic")], io)).toBe(1);
  });
});

describe("runCli", () => {
  test("exits 2 with usage for an unknown command", () => {
    const { io, err } = fakeIo();
    const code = runCli(["frobnicate", fx("valid-epic")], io);

    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/usage/i);
  });
});

describe("runCli run (dry-run)", () => {
  test("selects the next ready ticket and exits 0 for a valid contract", () => {
    const { io, out } = fakeIo();
    const code = runCli(["run", fx("valid-epic"), "--dry-run"], io);

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Next ready ticket: T01");
    expect(out.join("\n")).toContain("No files changed.");
  });

  test("exits non-zero and reports BLOCKED for an invalid contract", () => {
    const { io, out } = fakeIo();
    const code = runCli(["run", fx("invalid-ticket"), "--dry-run"], io);

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("BLOCKED");
  });

  test("refuses live run (no --dry-run) with exit 2", () => {
    const { io, err } = fakeIo();
    expect(runCli(["run", fx("valid-epic")], io)).toBe(2);
    expect(err.join("\n")).toMatch(/dry-run/i);
  });

  test("rejects an unknown run flag with exit 2", () => {
    const { io } = fakeIo();
    expect(runCli(["run", fx("valid-epic"), "--dry-run", "--wat"], io)).toBe(2);
  });
});

const legacyFixture = path.join(fixturesDir, "..", "..", "importer", "__fixtures__", "legacy-sprint-5");

describe("runCli import (dry-run)", () => {
  test("prints a dry-run plan and exits 0, writing no validation artifact", () => {
    const { io, out, artifacts } = fakeIo();
    const code = runCli(["import", "--from-existing", legacyFixture, "--out", "/virtual/docs/epics/demo", "--dry-run"], io);

    expect(code).toBe(0);
    expect(out.join("\n")).toContain("epic.yaml");
    expect(out.join("\n")).toMatch(/dry.run/i);
    expect(artifacts).toHaveLength(0);
  });

  test("live import (no --dry-run) writes a contract and exits non-zero when it is not execution-ready", () => {
    const { io, out } = fakeIo();
    const outDir = path.join(os.tmpdir(), `forge-cli-import-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    cliTempDirs.push(outDir);

    const code = runCli(["import", "--from-existing", legacyFixture, "--out", outDir], io);

    expect(fs.existsSync(path.join(outDir, "epic.yaml"))).toBe(true);
    expect(code).toBe(1); // T02 has ambiguous fields, so the generated contract is not execution-ready
    expect(out.join("\n")).toMatch(/requires human completion/i);
  });

  test("requires --from-existing and --out (exit 2)", () => {
    const { io } = fakeIo();
    expect(runCli(["import", "--dry-run"], io)).toBe(2);
  });

  test("rejects an unknown import flag (exit 2)", () => {
    const { io } = fakeIo();
    const code = runCli(["import", "--from-existing", legacyFixture, "--out", "/x", "--dry-run", "--wat"], io);
    expect(code).toBe(2);
  });
});

const sandboxEpicPath = path.join(fixturesDir, "..", "..", "..", "sandbox-epic");
const invalidTicketPath = path.join(fixturesDir, "invalid-ticket");

describe("runCli orchestration subcommands (read-only)", () => {
  test("packets <epic> emits the packet set as JSON with an absolute repo_root", () => {
    const { io, out } = fakeIo();
    const code = runCli(["packets", sandboxEpicPath], io);

    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as { engineer: { repo_root: string }; pm: unknown };
    expect(path.isAbsolute(parsed.engineer.repo_root)).toBe(true);
    expect(parsed.pm).toBeDefined();
  });

  test("packets exits non-zero (JSON ok:false) for a blocked/invalid epic", () => {
    const { io, out } = fakeIo();
    const code = runCli(["packets", invalidTicketPath], io);
    expect(code).toBe(1);
    expect(JSON.parse(out.join("\n")).ok).toBe(false);
  });

  test("dispatch <role> <epic> emits a deterministic dispatch spec with pinned repo_root", () => {
    const { io, out } = fakeIo();
    const code = runCli(["dispatch", "engineer", sandboxEpicPath], io);

    expect(code).toBe(0);
    const spec = JSON.parse(out.join("\n")) as { subagent_type: string; mode: string; prompt: string };
    expect(spec.subagent_type).toBe("general-purpose");
    expect(spec.mode).toBe("injected-charter");
    expect(spec.prompt).toContain("Evidence gathered outside repo_root is invalid evidence.");
  });

  test("dispatch rejects an unknown role (exit 2)", () => {
    const { io } = fakeIo();
    expect(runCli(["dispatch", "nope", sandboxEpicPath], io)).toBe(2);
  });

  test("parse-agent --file validates a good engineer output (exit 0, ok:true)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-parse-"));
    cliTempDirs.push(dir);
    const file = path.join(dir, "eng.yaml");
    fs.writeFileSync(
      file,
      "ticket: T01\nsummary: x\nfiles_changed: [{ path: src/sandbox/add.ts, adds: 1, dels: 0 }]\ntests: { added: 1, changed: 0 }\ncommands_run: [{ cmd: pnpm test, result: pass }]\nwithin_allowed_paths: true\n",
    );
    const { io, out } = fakeIo();
    const code = runCli(["parse-agent", "engineer", "--file", file], io);
    expect(code).toBe(0);
    expect(JSON.parse(out.join("\n")).ok).toBe(true);
  });

  test("parse-agent --file rejects a malformed engineer output (exit 1, ok:false)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-parse-"));
    cliTempDirs.push(dir);
    const file = path.join(dir, "bad.yaml");
    fs.writeFileSync(file, "summary: only a summary, missing required fields\n");
    const { io, out } = fakeIo();
    const code = runCli(["parse-agent", "engineer", "--file", file], io);
    expect(code).toBe(1);
    expect(JSON.parse(out.join("\n")).ok).toBe(false);
  });

  const pmBlock = "```yaml\ndecision: PASS\nrationale: ok\ndecision_id: D-001\njournal_entry: x\nhuman_gate_required: true\n```\n";

  test("parse-agent --file accepts a single fenced YAML block with surrounding prose (exit 0)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-parse-"));
    cliTempDirs.push(dir);
    const file = path.join(dir, "fenced.yaml");
    fs.writeFileSync(file, `Here is my decision:\n\n${pmBlock}\nThat completes the review.\n`);
    const { io, out } = fakeIo();
    const code = runCli(["parse-agent", "pm", "--file", file], io);
    expect(code).toBe(0);
    expect(JSON.parse(out.join("\n")).ok).toBe(true);
  });

  test("parse-agent --file rejects two YAML fenced blocks (exit 1, ambiguous)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-parse-"));
    cliTempDirs.push(dir);
    const file = path.join(dir, "twofence.yaml");
    fs.writeFileSync(file, `${pmBlock}\n${pmBlock}`);
    const { io, out } = fakeIo();
    const code = runCli(["parse-agent", "pm", "--file", file], io);
    expect(code).toBe(1);
    expect(JSON.parse(out.join("\n")).ok).toBe(false);
  });

  test("parse-agent rejects an unknown role (exit 2)", () => {
    const { io } = fakeIo();
    expect(runCli(["parse-agent", "wizard", "--stdin"], io)).toBe(2);
  });
});

describe("runCli parse-agent pm — Core-pinned decision_id cross-check", () => {
  const pmBlockWith = (id: string): string =>
    `\`\`\`yaml\ndecision: PASS\nrationale: ok\ndecision_id: ${id}\njournal_entry: x\nhuman_gate_required: true\n\`\`\`\n`;

  function writePmFile(contents: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-parse-pm-"));
    cliTempDirs.push(dir);
    const file = path.join(dir, "pm.yaml");
    fs.writeFileSync(file, contents);
    return file;
  }

  test("matching --expected-decision-id passes (exit 0, ok:true)", () => {
    const file = writePmFile(pmBlockWith("D-007"));
    const { io, out } = fakeIo();
    const code = runCli(["parse-agent", "pm", "--file", file, "--expected-decision-id", "D-007"], io);
    expect(code).toBe(0);
    expect(JSON.parse(out.join("\n")).ok).toBe(true);
  });

  test("mismatch exits 1 with DECISION_ID_MISMATCH after the strict schema validates", () => {
    const file = writePmFile(pmBlockWith("D-001"));
    const { io, out } = fakeIo();
    const code = runCli(["parse-agent", "pm", "--file", file, "--expected-decision-id", "D-002"], io);
    expect(code).toBe(1);
    const parsed = JSON.parse(out.join("\n")) as { code: string; expected: string; actual: string };
    expect(parsed.code).toBe("DECISION_ID_MISMATCH");
    expect(parsed.expected).toBe("D-002");
    expect(parsed.actual).toBe("D-001");
  });

  test("absent --expected-decision-id keeps the previous behavior (schema-only)", () => {
    const file = writePmFile(pmBlockWith("D-999"));
    const { io, out } = fakeIo();
    const code = runCli(["parse-agent", "pm", "--file", file], io);
    expect(code).toBe(0);
    expect(JSON.parse(out.join("\n")).ok).toBe(true);
  });

  test("schema-invalid PM output still fails first (no cross-check applied)", () => {
    const file = writePmFile("decision: MAYBE\nrationale: x\ndecision_id: D-001\njournal_entry: y\nhuman_gate_required: false\n");
    const { io, out } = fakeIo();
    const code = runCli(["parse-agent", "pm", "--file", file, "--expected-decision-id", "D-001"], io);
    expect(code).toBe(1);
    const parsed = JSON.parse(out.join("\n")) as { ok: boolean; code: string };
    expect(parsed.ok).toBe(false);
    // schema rejection — never reaches the cross-check
    expect(parsed.code).not.toBe("DECISION_ID_MISMATCH");
  });

  test("--expected-decision-id on a non-pm role is rejected with usage (exit 2)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-parse-pm-"));
    cliTempDirs.push(dir);
    const file = path.join(dir, "x.yaml");
    fs.writeFileSync(file, "ticket: T01\nsummary: x\nfiles_changed: []\ntests: { added: 0, changed: 0 }\ncommands_run: []\nwithin_allowed_paths: true\n");
    const { io } = fakeIo();
    const code = runCli(["parse-agent", "engineer", "--file", file, "--expected-decision-id", "D-001"], io);
    expect(code).toBe(2);
  });
});

describe("runCli dispatch pm — deterministic input assembly", () => {
  function pmInputDir(): { dir: string; engineer: string; semantic: string; scope: string; facts: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-pm-"));
    cliTempDirs.push(dir);
    const engineer = path.join(dir, "engineer-output.yaml");
    const semantic = path.join(dir, "semantic-output.yaml");
    const scope = path.join(dir, "scope-output.yaml");
    const facts = path.join(dir, "facts.json");
    fs.writeFileSync(
      engineer,
      "ticket: T01\nsummary: add helper\nfiles_changed: [{ path: src/sandbox/add.ts, adds: 3, dels: 0 }]\ntests: { added: 2, changed: 0 }\ncommands_run: [{ cmd: pnpm test, result: pass }]\nwithin_allowed_paths: true\n",
    );
    fs.writeFileSync(
      semantic,
      'verdict: APPROVE\nacceptance_checked: [{ id: 1, status: met, evidence: "add.ts:1" }]\nfindings: []\nrisk_level: low\n',
    );
    fs.writeFileSync(
      scope,
      "verdict: APPROVE\nchanged_files: [src/sandbox/add.ts]\nallowed_path_status: clean\nforbidden_path_violations: []\nunexpected_files: []\nrecommendation: in scope\n",
    );
    fs.writeFileSync(
      facts,
      JSON.stringify({
        parse_validation: { engineer: true, semantic_verifier: true, scope_verifier: true },
        verify_command_results: [{ cmd: "pnpm test", result: "pass" }],
        final_changed_files: ["src/sandbox/add.ts", "src/sandbox/add.test.ts"],
        final_branch_status: { branch: "forge/sandbox-epic/T01-add", ahead_of_base: 0, committed: false },
      }),
    );
    return { dir, engineer, semantic, scope, facts };
  }

  const pmArgs = (
    epic: string,
    f: { engineer: string; semantic: string; scope: string; facts: string },
    assignedDecisionId = "D-001",
  ): string[] => [
    "dispatch", "pm", epic,
    "--engineer-output", f.engineer,
    "--semantic-output", f.semantic,
    "--scope-output", f.scope,
    "--facts", f.facts,
    "--assigned-decision-id", assignedDecisionId,
  ];

  test("assembles the validated inputs into the PM prompt and writes nothing (exit 0)", () => {
    const f = pmInputDir();
    const { io, out, artifacts } = fakeIo();
    const code = runCli(pmArgs(sandboxEpicPath, f), io);

    expect(code).toBe(0);
    const spec = JSON.parse(out.join("\n")) as { role: string; prompt: string };
    expect(spec.role).toBe("pm");
    expect(spec.prompt).toContain("allowed_path_status"); // validated scope structure
    expect(spec.prompt).toContain("src/sandbox/add.test.ts"); // confirmed facts, not the scope output
    expect(spec.prompt).toContain("pnpm test => pass"); // verify results
    expect(artifacts).toHaveLength(0); // dispatch writes nothing
  });

  test("a missing facts file fails (non-zero)", () => {
    const f = pmInputDir();
    const { io } = fakeIo();
    const code = runCli(pmArgs(sandboxEpicPath, { ...f, facts: path.join(f.dir, "nope.json") }), io);
    expect(code).not.toBe(0);
  });

  test("an invalid engineer output fails (non-zero, ok:false)", () => {
    const f = pmInputDir();
    fs.writeFileSync(f.engineer, "summary: only a summary\n");
    const { io, out } = fakeIo();
    const code = runCli(pmArgs(sandboxEpicPath, f), io);
    expect(code).toBe(1);
    expect(JSON.parse(out.join("\n")).ok).toBe(false);
  });

  test("partial pm input flags are rejected with usage (exit 2)", () => {
    const f = pmInputDir();
    const { io } = fakeIo();
    const code = runCli(
      ["dispatch", "pm", sandboxEpicPath, "--engineer-output", f.engineer, "--assigned-decision-id", "D-001"],
      io,
    );
    expect(code).toBe(2);
  });

  test("agent-output flags on a non-pm role are rejected (exit 2)", () => {
    const f = pmInputDir();
    const { io } = fakeIo();
    const code = runCli(["dispatch", "engineer", sandboxEpicPath, "--engineer-output", f.engineer], io);
    expect(code).toBe(2);
  });

  test("dispatch pm with only --assigned-decision-id emits the skeleton + authoritative section (exit 0, no assembled inputs)", () => {
    const { io, out } = fakeIo();
    const code = runCli(["dispatch", "pm", sandboxEpicPath, "--assigned-decision-id", "D-001"], io);
    expect(code).toBe(0);
    const spec = JSON.parse(out.join("\n")) as { prompt: string };
    expect(spec.prompt).not.toContain("## Inputs (each validated");
    expect(spec.prompt).toContain("## Assigned decision_id (authoritative");
    expect(spec.prompt).toContain("decision_id: D-001");
  });

  test("dispatch pm without --assigned-decision-id fails with ASSIGNED_DECISION_ID_REQUIRED (exit 1)", () => {
    const { io, out } = fakeIo();
    const code = runCli(["dispatch", "pm", sandboxEpicPath], io);
    expect(code).toBe(1);
    expect(JSON.parse(out.join("\n")).code).toBe("ASSIGNED_DECISION_ID_REQUIRED");
  });

  test("dispatch pm with assembled inputs renders the assigned decision_id in the prompt", () => {
    const f = pmInputDir();
    const { io, out } = fakeIo();
    const code = runCli(pmArgs(sandboxEpicPath, f, "D-007"), io);
    expect(code).toBe(0);
    const spec = JSON.parse(out.join("\n")) as { prompt: string };
    expect(spec.prompt).toContain("## Assigned decision_id (authoritative");
    expect(spec.prompt).toContain("decision_id: D-007");
  });

  test("dispatch pm with a malformed --assigned-decision-id is rejected (ASSIGNED_DECISION_ID_REQUIRED)", () => {
    const f = pmInputDir();
    const { io, out } = fakeIo();
    const code = runCli(pmArgs(sandboxEpicPath, f, "X-1"), io);
    expect(code).toBe(1);
    expect(JSON.parse(out.join("\n")).code).toBe("ASSIGNED_DECISION_ID_REQUIRED");
  });

  test("--assigned-decision-id on a non-pm role is rejected with usage (exit 2)", () => {
    const { io } = fakeIo();
    const code = runCli(
      ["dispatch", "engineer", sandboxEpicPath, "--assigned-decision-id", "D-001"],
      io,
    );
    expect(code).toBe(2);
  });
});

describe("runCli active-ticket (deterministic forge-active-ticket/v1 emitter)", () => {
  test("emits a v1 object for the selected ticket, with an absolute repo_root, and writes nothing", () => {
    const { io, out, artifacts } = fakeIo();
    const code = runCli(["active-ticket", sandboxEpicPath], io);

    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as { schema: string; repo_root: string; ticket: string };
    expect(parsed.schema).toBe("forge-active-ticket/v1");
    expect(path.isAbsolute(parsed.repo_root)).toBe(true);
    expect(typeof parsed.ticket).toBe("string");
    expect(ActiveTicketSchema.safeParse(parsed).success).toBe(true); // emitted output is consumable by the guard
    expect(artifacts).toHaveLength(0);
  });

  test("the emitted paths match the selected ticket's packet fences", () => {
    const { io, out } = fakeIo();
    runCli(["active-ticket", sandboxEpicPath], io);
    const emitted = JSON.parse(out.join("\n")) as { allowed_paths: string[]; forbidden_paths: string[] };

    const packetsOut: string[] = [];
    runCli(["packets", sandboxEpicPath], { ...fakeIo().io, print: (t) => packetsOut.push(t) });
    const packets = JSON.parse(packetsOut.join("\n")) as { active_run: { allowed_paths: string[]; forbidden_paths: string[] } };

    expect(emitted.allowed_paths).toEqual(packets.active_run.allowed_paths);
    expect(emitted.forbidden_paths).toEqual(packets.active_run.forbidden_paths);
  });

  test("--json is accepted and emits the same JSON", () => {
    const { io, out } = fakeIo();
    expect(runCli(["active-ticket", sandboxEpicPath, "--json"], io)).toBe(0);
    expect(JSON.parse(out.join("\n")).schema).toBe("forge-active-ticket/v1");
  });

  test("exits non-zero (ok:false) for a blocked/invalid epic", () => {
    const { io, out } = fakeIo();
    const code = runCli(["active-ticket", invalidTicketPath], io);

    expect(code).toBe(1);
    expect(JSON.parse(out.join("\n")).ok).toBe(false);
  });

  test("rejects an unknown flag with usage (exit 2)", () => {
    const { io } = fakeIo();
    expect(runCli(["active-ticket", sandboxEpicPath, "--wat"], io)).toBe(2);
  });

  test("treats a missing epic path as a usage error (exit 2)", () => {
    const { io } = fakeIo();
    expect(runCli(["active-ticket"], io)).toBe(2);
  });
});

describe("runCli --repo-root (target-repo separation)", () => {
  const target = path.resolve(os.tmpdir(), "forge-target-fixture");

  test("packets --repo-root pins repo_root to the target, not cwd", () => {
    const { io, out } = fakeIo();
    const code = runCli(["packets", sandboxEpicPath, "--repo-root", target], io);

    expect(code).toBe(0);
    const p = JSON.parse(out.join("\n")) as { active_run: { repo_root: string }; engineer: { repo_root: string } };
    expect(p.active_run.repo_root).toBe(target);
    expect(p.engineer.repo_root).toBe(target);
  });

  test("packets defaults repo_root to cwd when --repo-root is omitted (backward-compatible)", () => {
    const { io, out } = fakeIo();
    runCli(["packets", sandboxEpicPath], io);

    expect(JSON.parse(out.join("\n")).active_run.repo_root).toBe(path.resolve(process.cwd()));
  });

  test("dispatch --repo-root embeds the target repo root in the spec", () => {
    const { io, out } = fakeIo();
    const code = runCli(["dispatch", "engineer", sandboxEpicPath, "--repo-root", target], io);

    expect(code).toBe(0);
    // Parse first so the prompt string carries real path separators (not JSON-escaped backslashes).
    const spec = JSON.parse(out.join("\n")) as { prompt: string };
    expect(spec.prompt).toContain(`repo_root: ${target}`);
  });

  test("active-ticket --repo-root emits repo_root === target, not cwd", () => {
    const { io, out } = fakeIo();
    const code = runCli(["active-ticket", sandboxEpicPath, "--repo-root", target], io);

    expect(code).toBe(0);
    expect(JSON.parse(out.join("\n")).repo_root).toBe(target);
  });
});

describe("runGuardPaths (path-fence guard)", () => {
  const activeTicket = {
    schema: "forge-active-ticket/v1",
    repo_root: "/repo",
    epic_path: "docs/epics/x",
    ticket: "T01",
    branch: "forge/x/T01",
    allowed_paths: ["src/example/**"],
    forbidden_paths: ["package.json"],
    protected_paths: ["**/manifest.yaml"],
  };

  function guardEnv(over: Partial<GuardEnv> = {}): GuardEnv {
    return {
      resolveRepoRoot: () => "/repo",
      readChangedFiles: () => [],
      readActiveTicket: () => JSON.stringify(activeTicket),
      ...over,
    };
  }

  function enoent(): never {
    const error = new Error("ENOENT: no such file") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }

  test("a clean change inside allowed_paths exits 0 and writes nothing", () => {
    const { io, out, artifacts } = fakeIo();
    const code = runGuardPaths(["paths"], io, guardEnv({ readChangedFiles: () => ["src/example/a.ts"] }));

    expect(code).toBe(0);
    expect(artifacts).toHaveLength(0);
    expect(out.join("\n")).toMatch(/OK|clean/i);
  });

  test("a change outside allowed_paths exits 1 with PATH_OUTSIDE_ALLOWED", () => {
    const { io, out } = fakeIo();
    const code = runGuardPaths(["paths"], io, guardEnv({ readChangedFiles: () => ["src/stray.ts"] }));

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("PATH_OUTSIDE_ALLOWED");
  });

  test("a forbidden-path change exits 1 with FORBIDDEN_PATH_TOUCHED", () => {
    const { io, out } = fakeIo();
    const code = runGuardPaths(["paths"], io, guardEnv({ readChangedFiles: () => ["package.json"] }));

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("FORBIDDEN_PATH_TOUCHED");
  });

  test("a protected-path change exits 1 with PROTECTED_PATH_TOUCHED", () => {
    const { io, out } = fakeIo();
    const code = runGuardPaths(["paths"], io, guardEnv({ readChangedFiles: () => ["docs/epics/x/manifest.yaml"] }));

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("PROTECTED_PATH_TOUCHED");
  });

  test("multiple violations across files are reported together (exit 1)", () => {
    const { io, out } = fakeIo();
    const code = runGuardPaths(["paths"], io, guardEnv({ readChangedFiles: () => ["src/stray.ts", "package.json"] }));

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("PATH_OUTSIDE_ALLOWED");
    expect(out.join("\n")).toContain("FORBIDDEN_PATH_TOUCHED");
  });

  test("a missing active-ticket file exits 1 with ACTIVE_TICKET_MISSING and never reads git", () => {
    const { io, out } = fakeIo();
    const code = runGuardPaths(["paths"], io, guardEnv({
      readActiveTicket: enoent,
      readChangedFiles: () => {
        throw new Error("git must not run when the active ticket is unreadable");
      },
    }));

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("ACTIVE_TICKET_MISSING");
  });

  test("a malformed active-ticket file exits 1 with ACTIVE_TICKET_INVALID", () => {
    const { io, out } = fakeIo();
    const code = runGuardPaths(["paths"], io, guardEnv({ readActiveTicket: () => "{ not json" }));

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("ACTIVE_TICKET_INVALID");
  });

  test("a worktree root that differs from the active ticket exits 1 with REPO_ROOT_MISMATCH and never reads git", () => {
    const { io, out } = fakeIo();
    const code = runGuardPaths(["paths"], io, guardEnv({
      resolveRepoRoot: () => "/some/other/repo",
      readChangedFiles: () => {
        throw new Error("git must not run on a repo_root mismatch");
      },
    }));

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("REPO_ROOT_MISMATCH");
  });

  test("--json emits a machine-readable result", () => {
    const { io, out } = fakeIo();
    const code = runGuardPaths(["paths", "--json"], io, guardEnv({ readChangedFiles: () => ["src/example/a.ts"] }));

    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as { ok: boolean; findings: unknown[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.findings).toEqual([]);
  });

  test("honors --active <path> when locating the active-ticket file", () => {
    let seen = "";
    const { io } = fakeIo();
    runGuardPaths(["paths", "--active", "custom/.forge/active-ticket.json"], io, guardEnv({
      readActiveTicket: (activePath) => {
        seen = activePath;
        return JSON.stringify(activeTicket);
      },
      readChangedFiles: () => ["src/example/a.ts"],
    }));

    expect(seen).toContain("custom");
  });

  test("--repo-root makes the guard observe the given target repo instead of cwd", () => {
    let seenBase = "";
    const target = path.resolve(os.tmpdir(), "forge-guard-target");
    const { io } = fakeIo();
    const code = runGuardPaths(["paths", "--repo-root", target], io, guardEnv({
      resolveRepoRoot: (dir) => {
        seenBase = dir;
        return target;
      },
      readChangedFiles: () => ["src/example/a.ts"],
      readActiveTicket: () => JSON.stringify({ ...activeTicket, repo_root: target }),
    }));

    expect(seenBase).toBe(target);
    expect(code).toBe(0); // observed root matches the active ticket's repo_root; allowed change → clean
  });

  test("rejects an unknown flag with usage (exit 2) before touching git or the active ticket", () => {
    const { io, err } = fakeIo();
    const code = runGuardPaths(["paths", "--wat"], io, guardEnv({
      readActiveTicket: () => {
        throw new Error("must not read the active ticket on a usage error");
      },
    }));

    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/guard|usage/i);
  });

  test("requires the `paths` subcommand (exit 2)", () => {
    const { io } = fakeIo();
    expect(runGuardPaths([], io, guardEnv())).toBe(2);
    expect(runGuardPaths(["bogus"], io, guardEnv())).toBe(2);
  });
});

describe("runCli guard routing", () => {
  test("`guard` with no subcommand exits 2 with usage", () => {
    const { io, err } = fakeIo();
    expect(runCli(["guard"], io)).toBe(2);
    expect(err.join("\n")).toMatch(/usage/i);
  });
});

describe("runCli verify-install routing", () => {
  test("routes `verify-install --wat` to the command, which rejects it with usage (exit 2)", () => {
    const { io, err } = fakeIo();
    const code = runCli(["verify-install", "--wat"], io);

    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/usage/i);
  });

  test("`verify-install` against the real checkout writes no validation artifact and returns 0 or 1", () => {
    const { io, artifacts } = fakeIo();
    const code = runCli(["verify-install"], io);

    // Read-only: it never goes through the validation artifact seam.
    expect(artifacts).toHaveLength(0);
    // Whether the local ~/.claude is current is environment-dependent; the
    // contract is only that it is one of the defined non-usage exit codes.
    expect([0, 1]).toContain(code);
  });
});

describe("runCli run-report write routing", () => {
  test("USAGE advertises the run-report write subcommand", () => {
    const { io, err } = fakeIo();
    runCli(["frobnicate"], io); // any unknown command surfaces USAGE
    expect(err.join("\n")).toContain("run-report write");
  });

  test("happy-path: runCli(['run-report', 'write', <epic>, ...args], io, {runReportIo}) writes one report", () => {
    const epic = "/epic/example";
    const forge = `${epic}/.forge`;
    const state: Record<string, string> = {
      [`${forge}/engineer-output.yaml`]: [
        "ticket: T01",
        "summary: add helper",
        "files_changed: [{ path: src/sandbox/add.ts, adds: 3, dels: 0 }]",
        "tests: { added: 2, changed: 0 }",
        "commands_run: [{ cmd: pnpm test, result: pass }]",
        "within_allowed_paths: true",
        "",
      ].join("\n"),
      [`${forge}/semantic-verifier-output.yaml`]: [
        "verdict: APPROVE",
        'acceptance_checked: [{ id: 1, status: met, evidence: "a.ts:1" }]',
        "findings: []",
        "risk_level: low",
        "",
      ].join("\n"),
      [`${forge}/scope-verifier-output.yaml`]: [
        "verdict: APPROVE",
        "changed_files: [src/sandbox/add.ts]",
        "allowed_path_status: clean",
        "forbidden_path_violations: []",
        "unexpected_files: []",
        "recommendation: in scope",
        "",
      ].join("\n"),
      [`${forge}/pm-output.yaml`]: [
        "decision: PASS",
        "rationale: green",
        "decision_id: D-001",
        "journal_entry: T01 PASS",
        "human_gate_required: true",
        "",
      ].join("\n"),
      [`${forge}/orchestrator-facts.json`]: JSON.stringify({
        parse_validation: { engineer: true, semantic_verifier: true, scope_verifier: true },
        verify_command_results: [{ cmd: "pnpm test", result: "pass" }],
        final_changed_files: ["src/sandbox/add.ts"],
        final_branch_status: { branch: "forge/x/T01", ahead_of_base: 0, committed: false },
      }),
      [`${forge}/active-ticket.json`]: JSON.stringify({
        schema: "forge-active-ticket/v1",
        repo_root: "/repo",
        epic_path: epic,
        ticket: "T01",
        branch: "forge/x/T01",
        allowed_paths: ["src/sandbox/**"],
        forbidden_paths: ["package.json"],
        protected_paths: ["**/manifest.yaml"],
      }),
    };

    const writes: { file: string; contents: string }[] = [];
    const runReportIo: RunReportIo = {
      readFileIfExists: (file) => {
        const normalized = file.replace(/\\/g, "/");
        return Object.prototype.hasOwnProperty.call(state, normalized) ? (state[normalized] ?? null) : null;
      },
      writeFile: (file, contents) => {
        writes.push({ file: file.replace(/\\/g, "/"), contents });
        state[file.replace(/\\/g, "/")] = contents;
      },
    };

    const { io } = fakeIo();
    const code = runCli(
      [
        "run-report",
        "write",
        epic,
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
        "--gate-declared",
        "pr",
        "--gate-effective",
        "pr",
        "--gate-human-required",
        "true",
      ],
      io,
      { runReportIo },
    );

    expect(code).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.file).toBe(`${forge}/run-report.json`);
    const parsed = JSON.parse(writes[0]?.contents ?? "") as { schema: string; result: string };
    expect(parsed.schema).toBe("forge-run-report/v1");
    expect(parsed.result).toBe("PASS");
  });
});
