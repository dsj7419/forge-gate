import { z } from "zod";

import { NonEmptyStringSchema, TicketIdSchema } from "../schema/enums.js";

const NonNegInt = z.number().int().nonnegative();

/** Engineer change-set output (see the forge-engineer charter). */
export const EngineerOutputSchema = z
  .object({
    ticket: TicketIdSchema,
    summary: NonEmptyStringSchema,
    files_changed: z.array(
      z.object({ path: NonEmptyStringSchema, adds: NonNegInt, dels: NonNegInt }).strict(),
    ),
    tests: z.object({ added: NonNegInt, changed: NonNegInt }).strict(),
    commands_run: z.array(z.object({ cmd: NonEmptyStringSchema, result: z.enum(["pass", "fail"]) }).strict()),
    risks: z.array(NonEmptyStringSchema).default([]),
    deviations: z.array(NonEmptyStringSchema).default([]),
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
          id: z.union([NonEmptyStringSchema, z.number()]),
          status: z.enum(["met", "unmet"]),
          evidence: NonEmptyStringSchema,
        })
        .strict(),
    ),
    findings: z.array(
      z
        .object({
          severity: FindingSeverityEnum,
          claim: NonEmptyStringSchema,
          reality: NonEmptyStringSchema,
          evidence: NonEmptyStringSchema,
        })
        .strict(),
    ),
    missing_proof: z.array(NonEmptyStringSchema).default([]),
    risk_level: z.enum(["low", "medium", "high", "critical"]),
  })
  .strict();

/** Scope verifier output (see the forge-scope-verifier charter). */
export const ScopeVerifierOutputSchema = z
  .object({
    verdict: VerdictEnum,
    changed_files: z.array(NonEmptyStringSchema).default([]),
    allowed_path_status: z.enum(["clean", "violations"]),
    forbidden_path_violations: z.array(NonEmptyStringSchema).default([]),
    unexpected_files: z.array(NonEmptyStringSchema).default([]),
    recommendation: NonEmptyStringSchema,
  })
  .strict();

const PMDecisionEnum = z.enum(["PASS", "CORRECT", "ESCALATE"]);

/** PM decision output (see the forge-pm charter). */
export const PMOutputSchema = z
  .object({
    decision: PMDecisionEnum,
    rationale: NonEmptyStringSchema,
    instructions: z.array(NonEmptyStringSchema).default([]),
    decision_id: z.string().regex(/^D-\d+$/, "decision_id must match D-<digits> (e.g. D-001)"),
    journal_entry: NonEmptyStringSchema,
    human_gate_required: z.boolean(),
  })
  .strict()
  .superRefine((pm, ctx) => {
    if (pm.decision === "CORRECT" && pm.instructions.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a CORRECT decision must include at least one instruction",
        path: ["instructions"],
      });
    }
  });

export type EngineerOutput = z.infer<typeof EngineerOutputSchema>;
export type SemanticVerifierOutput = z.infer<typeof SemanticVerifierOutputSchema>;
export type ScopeVerifierOutput = z.infer<typeof ScopeVerifierOutputSchema>;
export type PMOutput = z.infer<typeof PMOutputSchema>;
