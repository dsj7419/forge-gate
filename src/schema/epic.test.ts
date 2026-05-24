import { describe, expect, test } from "vitest";

import { EpicSchema } from "./epic.js";

const validEpic = {
  schema_version: 1,
  id: "idle-engine",
  sprints: ["sprint-05-foundation", "sprint-06-runtime"],
  gate_policy: { default_push: "human", default_merge: "human" },
};

describe("EpicSchema", () => {
  test("parses a valid epic (title optional)", () => {
    expect(EpicSchema.safeParse(validEpic).success).toBe(true);
  });

  test("parses an epic that includes a title", () => {
    expect(EpicSchema.safeParse({ ...validEpic, title: "Idle Engine" }).success).toBe(true);
  });

  test("rejects an epic missing its sprint list", () => {
    const bad: Record<string, unknown> = { ...validEpic };
    delete bad.sprints;
    expect(EpicSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects a whitespace-only sprint entry", () => {
    expect(EpicSchema.safeParse({ ...validEpic, sprints: ["   "] }).success).toBe(false);
  });

  test("rejects a non-canonical sprint entry", () => {
    expect(EpicSchema.safeParse({ ...validEpic, sprints: ["sprint-5"] }).success).toBe(false);
  });
});
