import { z } from "zod/v4";

// Local zod/v4 primitives. The role schemas are the single source of truth for
// both Core validation (safeParse) and JSON Schema generation (z.toJSONSchema),
// so they declare their own zod/v4 primitives rather than importing the Zod-3
// contract primitives from ../schema/enums.js (which z.toJSONSchema cannot convert).
const NonEmpty = z.string().trim().min(1);
const TicketId = z.string().regex(/^T\d{2,}$/);
const NonNegInt = z.number().int().nonnegative();

/** Engineer change-set output (see the forge-engineer charter). */
export const EngineerOutputSchema = z
  .object({
    ticket: TicketId,
    summary: NonEmpty,
    files_changed: z.array(
      z.object({ path: NonEmpty, adds: NonNegInt, dels: NonNegInt }).strict(),
    ),
    tests: z.object({ added: NonNegInt, changed: NonNegInt }).strict(),
    commands_run: z.array(z.object({ cmd: NonEmpty, result: z.enum(["pass", "fail"]) }).strict()),
    risks: z.array(NonEmpty).default([]),
    deviations: z.array(NonEmpty).default([]),
    within_allowed_paths: z.boolean(),
  })
  .strict();

const VerdictEnum = z.enum(["APPROVE", "REJECT"]);
const FindingSeverityEnum = z.enum(["blocker", "major", "minor", "nit"]);

/** Semantic verifier output (see the forge-semantic-verifier charter). */
export const SemanticVerifierOutputSchema = z
  .object({
    verdict: VerdictEnum,
    acceptance_checked: z.array(
      z
        .object({
          id: z.union([NonEmpty, z.number()]),
          status: z.enum(["met", "unmet"]),
          evidence: NonEmpty,
        })
        .strict(),
    ),
    findings: z.array(
      z
        .object({
          severity: FindingSeverityEnum,
          claim: NonEmpty,
          reality: NonEmpty,
          evidence: NonEmpty,
        })
        .strict(),
    ),
    missing_proof: z.array(NonEmpty).default([]),
    risk_level: z.enum(["low", "medium", "high", "critical"]),
  })
  .strict();

/** Scope verifier output (see the forge-scope-verifier charter). */
export const ScopeVerifierOutputSchema = z
  .object({
    verdict: VerdictEnum,
    changed_files: z.array(NonEmpty).default([]),
    allowed_path_status: z.enum(["clean", "violations"]),
    forbidden_path_violations: z.array(NonEmpty).default([]),
    unexpected_files: z.array(NonEmpty).default([]),
    recommendation: NonEmpty,
  })
  .strict();

const PMDecisionEnum = z.enum(["PASS", "CORRECT", "ESCALATE"]);

/** PM decision output (see the forge-pm charter). */
export const PMOutputSchema = z
  .object({
    decision: PMDecisionEnum,
    rationale: NonEmpty,
    instructions: z.array(NonEmpty).default([]),
    decision_id: z.string().regex(/^D-\d+$/, "decision_id must match D-<digits> (e.g. D-001)"),
    journal_entry: NonEmpty,
    human_gate_required: z.boolean(),
  })
  .strict()
  .superRefine((pm, ctx) => {
    if (pm.decision === "CORRECT" && pm.instructions.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "a CORRECT decision must include at least one instruction",
        path: ["instructions"],
      });
    }
  });

export type EngineerOutput = z.infer<typeof EngineerOutputSchema>;
export type SemanticVerifierOutput = z.infer<typeof SemanticVerifierOutputSchema>;
export type ScopeVerifierOutput = z.infer<typeof ScopeVerifierOutputSchema>;
export type PMOutput = z.infer<typeof PMOutputSchema>;

/** Role identifiers for output validation and dispatch. */
export type AgentRole = "engineer" | "semantic-verifier" | "scope-verifier" | "pm";

/** The role-output schema map — the single source of truth for both safeParse and JSON Schema. */
export const ROLE_SCHEMAS = {
  engineer: EngineerOutputSchema,
  "semantic-verifier": SemanticVerifierOutputSchema,
  "scope-verifier": ScopeVerifierOutputSchema,
  pm: PMOutputSchema,
} as const satisfies Record<AgentRole, z.ZodType>;

/**
 * Emit the JSON Schema for a role's output, derived from the same zod/v4 schema
 * Core validates against. The future workflow runner uses this for `agent({schema})`;
 * Core still re-validates with safeParse (refinements, patterns, bounds, and
 * non-emptiness are enforced only by the Zod pass, not by JSON Schema).
 */
export function toRoleJsonSchema(role: AgentRole): unknown {
  return z.toJSONSchema(ROLE_SCHEMAS[role]);
}
