import { describe, expect, test } from "vitest";

import { GatePolicySchema } from "./gate-policy.js";
import { ManifestSchema } from "./manifest.js";

const validManifest = {
  schema_version: 1,
  sprint: "sprint-05-runtime",
  gate_policy: { default_push: "human", default_merge: "human" },
  tickets: [
    { id: "T01", kind: "plan", status: "merged" },
    { id: "T03", kind: "green", depends_on: ["T02"], status: "engineering" },
  ],
};

describe("GatePolicySchema", () => {
  test("parses and defaults merge_strategy to squash", () => {
    const result = GatePolicySchema.safeParse({ default_push: "human", default_merge: "auto" });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected ok result");
    expect(result.data.merge_strategy).toBe("squash");
  });

  test("rejects an invalid merge_strategy", () => {
    const bad = { default_push: "human", default_merge: "human", merge_strategy: "fast-forward" };
    expect(GatePolicySchema.safeParse(bad).success).toBe(false);
  });

  test("rejects an invalid gate actor", () => {
    expect(GatePolicySchema.safeParse({ default_push: "robot", default_merge: "human" }).success).toBe(false);
  });
});

describe("ManifestSchema", () => {
  test("parses a valid manifest, defaulting integration_base and entry deps", () => {
    const result = ManifestSchema.safeParse(validManifest);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(JSON.stringify(result.error.issues));
    expect(result.data.integration_base).toBe("main");
    expect(result.data.tickets[0]?.depends_on).toEqual([]);
  });

  test("rejects a ticket entry with an invalid status", () => {
    const bad = { ...validManifest, tickets: [{ id: "T01", kind: "plan", status: "done" }] };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  test("defaults a ticket entry's blocks to an empty array", () => {
    const result = ManifestSchema.safeParse(validManifest);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(JSON.stringify(result.error.issues));
    expect(result.data.tickets[0]?.blocks).toEqual([]);
  });

  test("rejects an empty tickets array", () => {
    expect(ManifestSchema.safeParse({ ...validManifest, tickets: [] }).success).toBe(false);
  });

  test("rejects a non-canonical sprint id", () => {
    expect(ManifestSchema.safeParse({ ...validManifest, sprint: "sprint-5" }).success).toBe(false);
  });
});
