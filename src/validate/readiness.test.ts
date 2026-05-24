import { describe, expect, test } from "vitest";

import { validateReadiness } from "./readiness.js";
import { makeContract, makeSprint, makeTicket } from "./test-builders.js";

const codesFor = (sprintTicket: ReturnType<typeof makeTicket>): string[] =>
  validateReadiness(makeContract({ sprints: [makeSprint({ tickets: [sprintTicket] })] })).map((f) => f.code);

describe("validateReadiness", () => {
  test("returns no findings for a clean, execution-ready contract", () => {
    expect(validateReadiness(makeContract())).toEqual([]);
  });

  // 1. Path overlap
  test("flags exact allowed/forbidden path duplicates", () => {
    const ticket = makeTicket({ allowed_paths: ["src/runtime/**"], forbidden_paths: ["src/runtime/**"] });
    expect(codesFor(ticket)).toContain("PATH_GLOB_OVERLAP");
  });

  test("flags a broad allowed path overlapping a narrower forbidden path", () => {
    const ticket = makeTicket({ allowed_paths: ["src/**"], forbidden_paths: ["src/internal/**"] });
    expect(codesFor(ticket)).toContain("PATH_GLOB_OVERLAP");
  });

  test("does not flag unrelated allowed/forbidden paths", () => {
    const ticket = makeTicket({ allowed_paths: ["src/**"], forbidden_paths: ["docs/**"] });
    expect(codesFor(ticket)).not.toContain("PATH_GLOB_OVERLAP");
  });

  test("does not flag sibling prefixes (src/app vs src/application)", () => {
    const ticket = makeTicket({ allowed_paths: ["src/app/**"], forbidden_paths: ["src/application/**"] });
    expect(codesFor(ticket)).not.toContain("PATH_GLOB_OVERLAP");
  });

  test("does not flag a literal prefix that is not a path-boundary ancestor (src/app vs src/app2)", () => {
    const ticket = makeTicket({ allowed_paths: ["src/app"], forbidden_paths: ["src/app2/**"] });
    expect(codesFor(ticket)).not.toContain("PATH_GLOB_OVERLAP");
  });

  // 2. Acceptance criteria
  test("flags a missing acceptance-criteria heading", () => {
    const ticket = makeTicket({}, { body: "# Title\n\nSome description, no criteria.\n" });
    expect(codesFor(ticket)).toContain("ACCEPTANCE_CRITERIA_MISSING");
  });

  test("flags an empty acceptance-criteria section", () => {
    const ticket = makeTicket({}, { body: "## Acceptance Criteria\n\n" });
    expect(codesFor(ticket)).toContain("ACCEPTANCE_CRITERIA_MISSING");
  });

  test("accepts a populated acceptance section", () => {
    const ticket = makeTicket({}, { body: "## Acceptance\n\n- [ ] it works\n" });
    expect(codesFor(ticket)).not.toContain("ACCEPTANCE_CRITERIA_MISSING");
  });

  test("flags an acceptance section that is immediately followed by another heading", () => {
    const ticket = makeTicket({}, { body: "## Acceptance Criteria\n\n## Notes\n\nSomething else\n" });
    expect(codesFor(ticket)).toContain("ACCEPTANCE_CRITERIA_MISSING");
  });

  // 3. Verify commands required by kind
  test("flags a red ticket with empty verify_commands", () => {
    const ticket = makeTicket({ kind: "red", verify_commands: [] });
    expect(codesFor(ticket)).toContain("VERIFY_COMMANDS_REQUIRED");
  });

  test("flags a green ticket with empty verify_commands", () => {
    const ticket = makeTicket({ kind: "green", verify_commands: [] });
    expect(codesFor(ticket)).toContain("VERIFY_COMMANDS_REQUIRED");
  });

  test("allows a plan ticket with empty verify_commands", () => {
    const ticket = makeTicket({ kind: "plan", verify_commands: [] });
    expect(codesFor(ticket)).not.toContain("VERIFY_COMMANDS_REQUIRED");
  });

  test("allows a closeout ticket with empty verify_commands", () => {
    const ticket = makeTicket({ kind: "closeout", verify_commands: [] });
    expect(codesFor(ticket)).not.toContain("VERIFY_COMMANDS_REQUIRED");
  });

  // 4. Gate policy auto/auto
  test("flags an epic gate policy of auto/auto", () => {
    const contract = makeContract({ gatePolicy: { default_push: "auto", default_merge: "auto" } });
    expect(validateReadiness(contract).map((f) => f.code)).toContain("GATE_POLICY_AUTO_AUTO");
  });

  test("flags a manifest gate policy of auto/auto", () => {
    const contract = makeContract({
      sprints: [makeSprint({ gatePolicy: { default_push: "auto", default_merge: "auto" } })],
    });
    expect(validateReadiness(contract).map((f) => f.code)).toContain("GATE_POLICY_AUTO_AUTO");
  });

  // 5. Auto-escalation
  test("flags a security ticket that is not manually gated", () => {
    const ticket = makeTicket({ change_class: "security", gate: "pr" });
    expect(codesFor(ticket)).toContain("AUTO_ESCALATION_REQUIRED");
  });

  test("accepts a security ticket gated manual", () => {
    const ticket = makeTicket({ change_class: "security", gate: "manual" });
    expect(codesFor(ticket)).not.toContain("AUTO_ESCALATION_REQUIRED");
  });

  test("accepts a migration ticket with a gate override + rationale", () => {
    const ticket = makeTicket({
      change_class: "migration",
      gate: "pr",
      gate_override: true,
      gate_override_rationale: "human pre-approved this migration",
    });
    expect(codesFor(ticket)).not.toContain("AUTO_ESCALATION_REQUIRED");
  });

  test("flags a high-risk keyword (auth) even when change_class is benign", () => {
    const ticket = makeTicket({ title: "Add auth login flow", change_class: "feature", gate: "pr" });
    expect(codesFor(ticket)).toContain("AUTO_ESCALATION_REQUIRED");
  });

  test("flags a destructive keyword (rm -rf) in a verify command", () => {
    const ticket = makeTicket({ change_class: "feature", gate: "pr", verify_commands: ["rm -rf build"] });
    expect(codesFor(ticket)).toContain("AUTO_ESCALATION_REQUIRED");
  });

  test("flags an env-file path (.env.local) in allowed_paths", () => {
    const ticket = makeTicket({ change_class: "feature", gate: "pr", allowed_paths: [".env.local"] });
    expect(codesFor(ticket)).toContain("AUTO_ESCALATION_REQUIRED");
  });

  test("flags a migrations path in allowed_paths", () => {
    const ticket = makeTicket({ change_class: "feature", gate: "pr", allowed_paths: ["migrations/create-user.sql"] });
    expect(codesFor(ticket)).toContain("AUTO_ESCALATION_REQUIRED");
  });

  test("flags 'production' in the body", () => {
    const ticket = makeTicket({ change_class: "feature", gate: "pr" }, { body: "## Acceptance Criteria\n\n- [ ] deploy to production\n" });
    expect(codesFor(ticket)).toContain("AUTO_ESCALATION_REQUIRED");
  });

  test("flags a 'secret' path in forbidden_paths", () => {
    const ticket = makeTicket({ change_class: "feature", gate: "pr", forbidden_paths: ["config/secret.json"] });
    expect(codesFor(ticket)).toContain("AUTO_ESCALATION_REQUIRED");
  });

  test("does not escalate on 'product' (must not match the 'prod' keyword)", () => {
    const ticket = makeTicket({ title: "Improve product onboarding", change_class: "feature", gate: "pr" });
    expect(codesFor(ticket)).not.toContain("AUTO_ESCALATION_REQUIRED");
  });
});
