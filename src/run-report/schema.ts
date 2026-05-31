import { z } from "zod";

import { NonEmptyStringSchema, TicketIdSchema } from "../schema/enums.js";

/**
 * Core-owned, strict schema for the `forge-run-report/v1` runtime evidence
 * artifact. The orchestrator writes one of these to `$EPIC/.forge/run-report.json`
 * at the commit gate (`result: "PASS"`) or on terminal failure
 * (`result: "ESCALATE"`); it is **runtime evidence only**, never status
 * write-back, never journal automation, never run identity, never commit/push/
 * PR/merge automation.
 *
 * The v1 safety thesis is encoded in the schema: every `safety.*` boolean is
 * `z.literal(false)`. A future caller cannot silently flip `safety.committed`
 * to `true` and have the schema accept it — that is a deliberate `v2` bump.
 *
 * The top-level object is `.strict()` so unknown keys are rejected (closing the
 * field-drift gap that motivated promoting this artifact to Core).
 */

export const RUN_REPORT_SCHEMA = "forge-run-report/v1";
export const RUN_REPORT_COMMAND = "/forge-run-ticket";

const DecisionIdSchema = z
  .string()
  .regex(/^D-\d+$/, "decision_id must match D-<digits> (e.g. D-001)");

const VerifyCommandResultSchema = z
  .object({
    cmd: NonEmptyStringSchema,
    result: z.enum(["pass", "fail"]),
  })
  .strict();

const GateSchema = z
  .object({
    declared: NonEmptyStringSchema,
    effective: NonEmptyStringSchema,
    human_required: z.boolean(),
  })
  .strict();

const CheckpointSchema = z
  .object({
    base: NonEmptyStringSchema,
    head: NonEmptyStringSchema,
  })
  .strict();

const ParseValidationSchema = z
  .object({
    engineer: z.boolean(),
    semantic_verifier: z.boolean(),
    scope_verifier: z.boolean(),
    pm: z.boolean(),
  })
  .strict();

const GuardSchema = z
  .object({
    result: NonEmptyStringSchema,
    exit: z.number().int(),
  })
  .strict();

const VerifiersSchema = z
  .object({
    semantic: z.enum(["APPROVE", "REJECT"]),
    scope: z.enum(["APPROVE", "REJECT"]),
  })
  .strict();

const FinalBranchStatusSchema = z
  .object({
    branch: NonEmptyStringSchema,
    ahead_of_base: z.number().int().nonnegative(),
    committed: z.literal(false),
  })
  .strict();

const AgentOutputsSchema = z
  .object({
    engineer: NonEmptyStringSchema,
    semantic_verifier: NonEmptyStringSchema,
    scope_verifier: NonEmptyStringSchema,
    pm: NonEmptyStringSchema,
  })
  .strict();

/**
 * The trust-path label recording which evidence path produced each agent's
 * output. It deliberately collapses "format" and "capture authority" into one
 * value:
 * - `yaml_text` — captured and validated from the YAML/text path.
 * - `structured_json` — captured as a structured JSON/object output, then
 *   validated by Core.
 * - `workflow_core_runner` — RESERVED for future workflow/core-runner
 *   deterministic capture. Accepted by the schema so a Phase 2 emitter does not
 *   re-open the frozen schema, but nothing in 1c emits it.
 */
const AgentOutputSourceValue = z.enum([
  "yaml_text",
  "structured_json",
  "workflow_core_runner",
]);

/**
 * Optional, per-role provenance object. Each role is individually optional and
 * the object is `.strict()` so unknown role keys are rejected while any subset
 * of the four known roles is accepted.
 */
const AgentOutputSourceSchema = z
  .object({
    engineer: AgentOutputSourceValue.optional(),
    semantic_verifier: AgentOutputSourceValue.optional(),
    scope_verifier: AgentOutputSourceValue.optional(),
    pm: AgentOutputSourceValue.optional(),
  })
  .strict();

const CommitGateMaterialsSchema = z
  .object({
    proposed_status_transition: NonEmptyStringSchema,
    suggested_commit_message: NonEmptyStringSchema,
    suggested_commands: z.array(NonEmptyStringSchema),
  })
  .strict();

/**
 * The v1 safety invariants. Every flag is `z.literal(false)` — not
 * `z.boolean()` — because v1 explicitly forbids commit / push / PR / merge /
 * status write-back / journal write. Flipping any of these to `true` is a
 * deliberate schema version bump, never a silent change.
 */
const SafetySchema = z
  .object({
    committed: z.literal(false),
    pushed: z.literal(false),
    pr_opened: z.literal(false),
    merged: z.literal(false),
    status_write_back: z.literal(false),
    journal_written: z.literal(false),
  })
  .strict();

export const RunReportSchema = z
  .object({
    schema: z.literal(RUN_REPORT_SCHEMA),
    command: z.literal(RUN_REPORT_COMMAND),
    result: z.enum(["PASS", "ESCALATE"]),
    epic_path: NonEmptyStringSchema,
    target_repo: NonEmptyStringSchema,
    ticket: TicketIdSchema,
    ticket_title: NonEmptyStringSchema,
    branch: NonEmptyStringSchema,
    decision: z.enum(["PASS", "CORRECT", "ESCALATE"]),
    decision_id: DecisionIdSchema,
    human_gate_required: z.boolean(),
    gate: GateSchema,
    checkpoint: CheckpointSchema,
    parse_validation: ParseValidationSchema,
    verify_command_results: z.array(VerifyCommandResultSchema),
    guard: GuardSchema,
    verifiers: VerifiersSchema,
    final_changed_files: z.array(NonEmptyStringSchema),
    final_branch_status: FinalBranchStatusSchema,
    agent_outputs: AgentOutputsSchema,
    commit_gate_materials: CommitGateMaterialsSchema.optional(),
    agent_output_source: AgentOutputSourceSchema.optional(),
    notes: z.array(NonEmptyStringSchema).optional(),
    safety: SafetySchema,
  })
  .strict();

export type RunReport = z.infer<typeof RunReportSchema>;
