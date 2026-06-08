import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

/**
 * These tests pin the YAML-output guidance in the four agent charters. They guard
 * against regressing the charters back toward inline flow mappings, which is what
 * produced the AGENT_OUTPUT_INVALID halt this ticket addresses (an object-list
 * entry written as `- { ... }` with an unquoted, comma-bearing scalar that the
 * strict Core parser splits into spurious keys and rejects).
 *
 * Scope is the charter templates only — Core's parser/schemas are unchanged.
 */

const CHARTERS = ["forge-engineer", "forge-semantic-verifier", "forge-scope-verifier", "forge-pm"] as const;

function charterPath(name: string): string {
  return fileURLToPath(new URL(`../../agents/${name}.md`, import.meta.url));
}

function readCharter(name: string): string {
  return readFileSync(charterPath(name), "utf8");
}

/** Return the body of every ```yaml fenced block in the charter markdown. */
function fencedYamlBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  let isYaml = false;
  let buffer: string[] = [];
  for (const line of lines) {
    const open = /^\s*```\s*([A-Za-z0-9_-]*)\s*$/.exec(line);
    if (!inFence) {
      if (open) {
        inFence = true;
        isYaml = /^ya?ml$/i.test(open[1] ?? "");
        buffer = [];
      }
      continue;
    }
    if (/^\s*```\s*$/.test(line)) {
      if (isYaml) blocks.push(buffer.join("\n"));
      inFence = false;
      isYaml = false;
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  return blocks;
}

describe("agent charters — YAML-output rule text", () => {
  for (const name of CHARTERS) {
    test(`${name} states the block-style mapping rule`, () => {
      const md = readCharter(name).toLowerCase();
      expect(md).toContain("block-style yaml mappings");
      expect(md).toContain("one key per line");
    });

    test(`${name} forbids inline flow mappings for object lists`, () => {
      const md = readCharter(name).toLowerCase();
      expect(md).toContain("do **not** use inline flow mappings");
    });

    test(`${name} states the punctuation-quoting rule`, () => {
      const md = readCharter(name);
      expect(md.toLowerCase()).toContain("quote every string value");
      // Names the punctuation that triggers quoting.
      for (const token of ["comma", "colon", "slash", "bracket", "brace", "parenthesis"]) {
        expect(md.toLowerCase()).toContain(token);
      }
    });

    test(`${name} requires exactly one YAML object with no surrounding prose`, () => {
      const md = readCharter(name).toLowerCase();
      expect(md).toContain("exactly one yaml object");
      expect(md).toContain("no prose before or after");
    });
  }
});

describe("agent charters — example uses block style for object lists", () => {
  for (const name of CHARTERS) {
    test(`${name} fenced YAML example has no inline flow mapping list entry (- { ... })`, () => {
      const blocks = fencedYamlBlocks(readCharter(name));
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        for (const line of block.split("\n")) {
          // An object-list entry written as a flow mapping starts with `- {`.
          expect(line).not.toMatch(/^\s*-\s*\{/);
        }
      }
    });
  }
});

describe("pm charter — Core-pinned decision_id pin-and-echo rule", () => {
  test("forge-pm.md states the decision_id is read verbatim from the dispatch packet (never invented)", () => {
    const md = readCharter("forge-pm");
    const lower = md.toLowerCase();
    // The new authoritative-section name from dispatch.ts (verbatim) is referenced.
    expect(md).toContain("## Assigned decision_id (authoritative");
    // "verbatim" is the operative word; emit it as-is.
    expect(lower).toContain("verbatim");
    // The agent must not invent or renumber the id.
    expect(lower).toContain("never invent");
    // Pin-and-echo lives alongside the human_gate_required rule.
    expect(lower).toContain("human_gate_required");
  });

  test("forge-pm.md's example shows the pinned placeholder, not a hard-coded D-001", () => {
    const blocks = fencedYamlBlocks(readCharter("forge-pm"));
    const example = blocks.find((b) => b.includes("decision_id:"));
    expect(example).toBeDefined();
    if (example === undefined) return;
    expect(example).toMatch(/decision_id:\s*<pinned>/);
    expect(example).toContain("never invent");
  });
});

describe("core-runner charter — scratch-capture scoping rules", () => {
  function readCoreRunner(): string {
    return readFileSync(charterPath("forge-core-runner"), "utf8");
  }

  test("forbids scratch/temp capture files in the session cwd, repoRoot, and any repository working tree", () => {
    const lower = readCoreRunner().toLowerCase();
    // The cwd/repo prohibition must be explicit.
    expect(lower).toContain("scratch");
    expect(lower).toContain("session cwd");
    expect(lower).toContain("reporoot");
    expect(lower).toContain("repository working tree");
  });

  test("requires necessary transient capture to use the OS temp directory, namespaced and cleaned up", () => {
    const lower = readCoreRunner().toLowerCase();
    expect(lower).toContain("os temporary directory");
    // Namespaced by the available run/session/call identifier.
    expect(lower).toContain("run_id");
    expect(lower).toContain("session_id");
    // Cleanup after readback is mandatory. Lock the precise "cleanup" term and
    // "readback" — NOT the broad "clean" token, which also matches "no git clean"
    // in the L3 deny section and would not protect this rule.
    expect(lower).toContain("cleanup");
    expect(lower).toContain("readback");
  });

  test("prefers inline capture when no scratch file is needed", () => {
    const lower = readCoreRunner().toLowerCase();
    expect(lower).toContain("inline");
  });

  test("preserves the verbatim-fidelity output contract (no synthesized output, no lossy summaries, exit authoritative)", () => {
    const lower = readCoreRunner().toLowerCase();
    // The full fidelity contract — each load-bearing concept locked by its own token,
    // so a future edit cannot quietly drop any one of them.
    expect(lower).toContain("verbatim");
    expect(lower).toContain("stdout");
    expect(lower).toContain("stderr");
    // No synthesized output / no lossy summaries are part of the core fidelity contract.
    expect(lower).toContain("synthesized");
    expect(lower).toContain("lossy");
    // No fabrication; exit code stays the authoritative signal.
    expect(lower).toContain("never fabricate");
    expect(lower).toContain("authoritative");
  });
});

describe("semantic-verifier charter — acceptance_checked example shape", () => {
  test("acceptance_checked is shown in block style with id/status/evidence on separate lines", () => {
    const blocks = fencedYamlBlocks(readCharter("forge-semantic-verifier"));
    const example = blocks.find((b) => b.includes("acceptance_checked:"));
    expect(example).toBeDefined();
    if (example === undefined) return;
    // The entry header is a bare list item, not a flow mapping.
    expect(example).toMatch(/acceptance_checked:\s*\n\s*-\s*id:/);
    expect(example).toMatch(/\n\s*status:/);
    expect(example).toMatch(/\n\s*evidence:/);
    // The evidence value with a colon is quoted in the example.
    expect(example).toMatch(/evidence:\s*"[^"]*"/);
  });
});
