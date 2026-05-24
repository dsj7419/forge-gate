import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { buildAgentDispatch, loadCharterBody } from "./dispatch.js";
import { generateRunPackets } from "./packets.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const agentsDir = path.join(repoRoot, "agents");
const sandboxEpic = path.join(repoRoot, "sandbox-epic");

function packets() {
  const result = generateRunPackets(sandboxEpic, repoRoot);
  if (!result.ok) throw new Error("expected packets");
  return result.packets;
}

describe("loadCharterBody", () => {
  test("loads the tracked charter body verbatim (frontmatter stripped)", () => {
    const body = loadCharterBody(agentsDir, "engineer");
    expect(body).toContain("You are the **Forge engineer**");
    expect(body).not.toContain("name: forge-engineer"); // frontmatter removed
  });

  test("throws for a missing charter (never improvises)", () => {
    expect(() => loadCharterBody(path.join(repoRoot, "no-such-dir"), "engineer")).toThrow();
  });
});

describe("buildAgentDispatch — injected-charter fallback", () => {
  test("uses general-purpose + injects the tracked charter, and pins repo_root + fences", () => {
    const d = buildAgentDispatch("engineer", packets(), { registeredAvailable: false, agentsDir });

    expect(d.subagent_type).toBe("general-purpose");
    expect(d.mode).toBe("injected-charter");
    expect(d.prompt).toContain("You are the **Forge engineer**"); // verbatim charter, not improvised
    expect(d.prompt).toContain(packets().engineer.repo_root); // absolute repo_root pinned
    expect(d.prompt).toContain("Evidence gathered outside repo_root is invalid evidence.");
    expect(d.prompt).toContain("src/sandbox/**"); // allowed_paths
  });
});

describe("buildAgentDispatch — registered mode", () => {
  test("uses the registered forge-<role> type and still pins repo_root", () => {
    const d = buildAgentDispatch("engineer", packets(), { registeredAvailable: true, agentsDir });

    expect(d.subagent_type).toBe("forge-engineer");
    expect(d.mode).toBe("registered");
    expect(d.prompt).toContain(packets().engineer.repo_root);
    expect(d.prompt).toContain("Evidence gathered outside repo_root is invalid evidence.");
  });

  test("maps each role to its registered subagent type", () => {
    const p = packets();
    expect(buildAgentDispatch("semantic-verifier", p, { registeredAvailable: true, agentsDir }).subagent_type).toBe("forge-semantic-verifier");
    expect(buildAgentDispatch("scope-verifier", p, { registeredAvailable: true, agentsDir }).subagent_type).toBe("forge-scope-verifier");
    expect(buildAgentDispatch("pm", p, { registeredAvailable: true, agentsDir }).subagent_type).toBe("forge-pm");
  });
});

describe("buildAgentDispatch — cwd discipline on every role", () => {
  test("every role's dispatch pins repo_root and the cwd-discipline statement", () => {
    const p = packets();
    for (const role of ["engineer", "semantic-verifier", "scope-verifier", "pm"] as const) {
      const d = buildAgentDispatch(role, p, { registeredAvailable: false, agentsDir });
      expect(d.prompt).toContain(p.engineer.repo_root);
      expect(d.prompt).toContain("Evidence gathered outside repo_root is invalid evidence.");
    }
  });
});
