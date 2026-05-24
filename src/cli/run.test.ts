import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

import type { ValidationReport } from "../validate/findings.js";
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

  test("parse-agent rejects an unknown role (exit 2)", () => {
    const { io } = fakeIo();
    expect(runCli(["parse-agent", "wizard", "--stdin"], io)).toBe(2);
  });
});
