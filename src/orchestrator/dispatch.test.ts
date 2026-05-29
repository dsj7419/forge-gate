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

/**
 * Packets with the PM `assigned_decision_id` slot filled — mirrors what
 * `buildPmDispatch` / the CLI skeleton path do before rendering the PM packet.
 * Lets non-PM-focused tests exercise the pm role without tripping the
 * defense-in-depth throw for a null slot.
 */
function packetsWithPmPinned(assignedDecisionId: string = "D-001") {
  const p = packets();
  return {
    ...p,
    pm: { ...p.pm, inputs: { ...p.pm.inputs, assigned_decision_id: assignedDecisionId } },
  };
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

  test("the engineer prompt carries the ticket body/acceptance, not just the id and fences", () => {
    const d = buildAgentDispatch("engineer", packets(), { registeredAvailable: false, agentsDir });
    expect(d.prompt).toContain("## Acceptance Criteria");
    expect(d.prompt).toContain("Create `src/sandbox/add.ts`"); // AI instructions from the ticket body
  });

  test("the engineer ticket section header honestly describes its content (body only, not front-matter)", () => {
    const d = buildAgentDispatch("engineer", packets(), { registeredAvailable: false, agentsDir });
    expect(d.prompt).toContain("## Ticket (body)"); // accurate label for the rendered body
    expect(d.prompt).not.toContain("## Ticket (front-matter + body)"); // old, inaccurate label is gone
  });

  test("the semantic-verifier prompt carries the acceptance criteria text", () => {
    const d = buildAgentDispatch("semantic-verifier", packets(), { registeredAvailable: false, agentsDir });
    expect(d.prompt).toContain("exports a pure function");
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
    const p = packetsWithPmPinned();
    expect(buildAgentDispatch("semantic-verifier", p, { registeredAvailable: true, agentsDir }).subagent_type).toBe("forge-semantic-verifier");
    expect(buildAgentDispatch("scope-verifier", p, { registeredAvailable: true, agentsDir }).subagent_type).toBe("forge-scope-verifier");
    expect(buildAgentDispatch("pm", p, { registeredAvailable: true, agentsDir }).subagent_type).toBe("forge-pm");
  });
});

describe("buildAgentDispatch — cwd discipline on every role", () => {
  test("every role's dispatch pins repo_root and the cwd-discipline statement", () => {
    const p = packetsWithPmPinned();
    for (const role of ["engineer", "semantic-verifier", "scope-verifier", "pm"] as const) {
      const d = buildAgentDispatch(role, p, { registeredAvailable: false, agentsDir });
      expect(d.prompt).toContain(p.engineer.repo_root);
      expect(d.prompt).toContain("Evidence gathered outside repo_root is invalid evidence.");
    }
  });

  test("pm dispatch throws when assigned_decision_id is null (skeleton-from-packets path)", () => {
    // `generateRunPackets` leaves `pm.inputs.assigned_decision_id` null in the
    // skeleton — the orchestrator must pin it (via `buildPmDispatch` or the CLI
    // skeleton path) before rendering. Calling `buildAgentDispatch('pm', ...)`
    // directly on a skeleton must fail closed rather than silently omit the
    // authoritative section the PM charter teaches the agent to read.
    expect(() => buildAgentDispatch("pm", packets(), { registeredAvailable: false, agentsDir })).toThrow(
      /pm.*assigned_decision_id must be pinned before the pm packet renders/i,
    );
  });
});
