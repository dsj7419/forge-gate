import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import type { ValidationReport } from "../validate/findings.js";
import { runCli, type CliIo } from "./run.js";

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

  test("refuses live import (no --dry-run) with exit 2 for v1", () => {
    const { io, err } = fakeIo();
    const code = runCli(["import", "--from-existing", legacyFixture, "--out", "/virtual/docs/epics/demo"], io);

    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/dry-run/i);
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
