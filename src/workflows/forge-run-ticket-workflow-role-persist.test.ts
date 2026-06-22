import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");

/**
 * Protocol-lock test: forge-run-ticket workflow ↔ Core-owned role-output persistence.
 *
 * The four role-output artifacts (engineer, semantic-verifier, scope-verifier, pm)
 * must be persisted by Core through the T01 surface `parse-agent <role>
 * --json-stdin --out "<.forge/<role>-output.json>"` — a single validate-then-write
 * Core command. The candidate object transits stdin; the workflow never hands JSON
 * bytes to a generic sub-agent to "write exact bytes" (the denied verdict-Write
 * shape). After this, the core-runner's only persistence action for a role output
 * is a Bash `forge` command — Core does the `fs` write.
 *
 * This suite is NON-TAUTOLOGICAL: it asserts both the PRESENCE of the new
 * `parse-agent <role> --json-stdin --out` persistence (for all four roles, at the
 * unchanged `.forge/<role>-output.json` paths, pm carrying --expected-decision-id)
 * AND the ABSENCE of the retired Write path — `writeForgeFile` is no longer used to
 * persist any of the four role outputs, and the separate `parse-agent --json-file`
 * validation is gone. If a future edit re-introduces the Write path or drops the
 * stdin wiring, this goes red.
 *
 * We assert on load-bearing tokens (not exact paragraphs) to avoid brittleness on
 * trivial copy edits, mirroring the sibling workflow protocol-lock suites.
 */

const WORKFLOW_FILE = join(REPO_ROOT, "workflows", "forge-run-ticket.workflow.js");

const text = (): string => readFileSync(WORKFLOW_FILE, "utf8");

const ROLE_OUTPUTS: ReadonlyArray<{ role: string; file: string }> = [
  { role: "engineer", file: "engineer-output.json" },
  { role: "semantic-verifier", file: "semantic-verifier-output.json" },
  { role: "scope-verifier", file: "scope-verifier-output.json" },
  { role: "pm", file: "pm-output.json" },
];

describe("forge-run-ticket workflow ↔ Core-owned role-output persistence (parse-agent --json-stdin --out)", () => {
  describe("present: each role output is persisted via parse-agent --json-stdin --out", () => {
    const REQUIRED_TOKENS: readonly string[] = [
      // The T01 Core-owned validate-then-write input/output flags.
      "--json-stdin",
      "--out",
      // The Core surface itself.
      "parse-agent",
    ];

    for (const token of REQUIRED_TOKENS) {
      it(`contains "${token}"`, () => {
        expect(text()).toContain(token);
      });
    }

    it("invokes parse-agent <role> --json-stdin --out for every role and unchanged destination path", () => {
      const src = text();
      for (const { role, file } of ROLE_OUTPUTS) {
        // The persist command carries the role, the stdin input mode, and the --out
        // destination at the unchanged `.forge/<role>-output.json` path.
        const re = new RegExp(
          `parse-agent\\s+\\$\\{?\\w*\\}?[^]*?--json-stdin[^]*?--out[^]*?${file.replace(".", "\\.")}|` +
            `parse-agent[^]*?${role}[^]*?--json-stdin[^]*?--out`,
        );
        expect(src, `role=${role}`).toMatch(re);
        // The destination path token itself must still be present (unchanged path).
        expect(src, `dest=${file}`).toContain(file);
      }
    });

    it("the stdin input mode --json-stdin is used (not the file-input --json-file fallback)", () => {
      const src = text();
      // PM-ratified: --json-stdin is the required transport; the --json-file input
      // fallback (a temp-file verdict Write) must NOT be reintroduced.
      expect(src).toContain("--json-stdin");
      expect(src).not.toContain("--json-file");
    });

    it("the pm persist still carries the ledger-derived expected decision id cross-check", () => {
      const src = text();
      expect(src).toContain("--expected-decision-id");
      // The expected id is wired into the pm persist (pm-only flag).
      expect(src).toMatch(/--expected-decision-id[^]*?expectedDecisionId|expectedDecisionId[^]*?--expected-decision-id/);
    });
  });

  describe("absent: the retired Write path for role outputs is gone (non-tautological half)", () => {
    it("does not persist any of the four role outputs via writeForgeFile", () => {
      const src = text();
      for (const { file } of ROLE_OUTPUTS) {
        // The agent byte-write of a role verdict (the denied shape) must be gone.
        expect(src, `writeForgeFile("${file}")`).not.toContain(`writeForgeFile("${file}"`);
      }
    });

    it("does not validate role outputs via the separate parse-agent --json-file step", () => {
      // The old two-step path was writeForgeFile + `parse-agent <role> --json-file`.
      // The migrated path folds validate+write into one --json-stdin --out command,
      // so no --json-file validation remains anywhere.
      expect(text()).not.toContain("--json-file");
    });

    it("does not use writeForgeFile to persist a role-output candidate object at all", () => {
      const src = text();
      // No remaining writeForgeFile call targets a *-output.json role artifact. The
      // workflow-authored orchestrator-facts.json (NOT a role verdict) is explicitly
      // out of scope this epic and may still use writeForgeFile.
      expect(src).not.toMatch(/writeForgeFile\(\s*["'][^"']*-output\.json/);
    });
  });

  describe("persist helper: a single Core command does validate-then-write over stdin", () => {
    it("serializes the role candidate object and pipes it to Core over stdin", () => {
      const src = text();
      // The validated candidate object (the typed agent({schema}) return) is
      // JSON-serialized and transported on stdin to the one Core command.
      expect(src).toMatch(/JSON\.stringify/);
      // A dedicated persist helper routes the four role outputs through the stdin
      // surface (named token kept stable for the lock).
      expect(src).toMatch(/persistAndValidateRole|persistRoleViaCore/);
    });
  });
});
