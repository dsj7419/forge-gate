import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");

/**
 * Lock test: forge-run-ticket capture-discipline contract.
 *
 * `commands/forge-run-ticket.md` is the run protocol the orchestrator obeys.
 * The one-action-per-step agent-output capture rule (dispatch → wait → capture
 * verbatim → parse-agent → continue) must live in the protocol text itself, not
 * only in operator memory. If a future edit drops the discipline phrases — the
 * verbatim-capture sequence, the prohibitions against pre-writing / summarizing /
 * reconstructing / composing / batching, or the halt-don't-repair behavior — this
 * suite goes red so the drift cannot ship silently.
 *
 * We assert on load-bearing phrases (not exact paragraphs) to avoid brittleness
 * on trivial copy edits, mirroring src/agents/charter-output-format.test.ts.
 */

const COMMAND_FILE = join(REPO_ROOT, "commands", "forge-run-ticket.md");

const text = (): string => readFileSync(COMMAND_FILE, "utf8");

const REQUIRED_PHRASES: readonly string[] = [
  // Top-level capture-discipline section exists.
  "Capture discipline",

  // The verbatim-capture sequence (per agent step).
  "dispatch the agent",
  "wait for the actual agent return",
  "verbatim",
  ".forge/<role>-output.yaml",
  "forge parse-agent",
  "continue only after parse succeeds",

  // Prohibitions.
  "pre-writing",
  "summarizing",
  "reconstructing",
  "composing",
  "batching",
  "validating synthesized output",

  // Halt / honest-reporting behavior.
  "AGENT_OUTPUT_INVALID",
  "halt",
  "missing required fields",
  "report fail",
  "report reject",
  "never rewrite an agent response",

  // Bootstrap + verify-install honesty.
  "verify-install",
  "pnpm install-commands",
  "bootstrap",
];

describe("forge-run-ticket capture-discipline contract", () => {
  it("contains the load-bearing capture-discipline phrases", () => {
    const content = text();
    for (const phrase of REQUIRED_PHRASES) {
      expect(content, `missing required phrase: ${phrase}`).toContain(phrase);
    }
  });

  it("requires the verbatim-capture sequence for every agent role", () => {
    const content = text();
    for (const role of ["engineer", "verifier", "pm"]) {
      expect(content, `missing role mention: ${role}`).toContain(role);
    }
  });
});
