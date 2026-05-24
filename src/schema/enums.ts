import { z } from "zod";

/** The only contract schema version this build understands. */
export const SCHEMA_VERSION = 1;

/** A trimmed, non-empty string. Rejects "" and whitespace-only values. */
export const NonEmptyStringSchema = z.string().trim().min(1);

/**
 * Ticket identifiers: a capital T followed by >= 2 digits (T01, T03, T100).
 * T1 is intentionally rejected so ids sort lexicographically and manifests stay tidy.
 */
export const TicketIdSchema = z
  .string()
  .regex(/^T\d{2,}$/, "ticket id must match /^T\\d{2,}$/ (e.g. T03; T1 is rejected)");

/** Canonical sprint folder identifier: sprint-NN-slug (e.g. sprint-05-runtime-actor). */
export const SprintIdSchema = z
  .string()
  .trim()
  .regex(
    /^sprint-\d{2,}-[a-z0-9-]+$/,
    "sprint id must match sprint-NN-slug (e.g. sprint-05-runtime-actor)",
  );

export const KindEnum = z.enum(["plan", "red", "green", "closeout"]);
export const RiskEnum = z.enum(["low", "medium", "high", "critical"]);
export const ChangeClassEnum = z.enum([
  "docs",
  "test",
  "refactor",
  "feature",
  "bugfix",
  "migration",
  "security",
  "infra",
  "dependency",
]);
export const BlastRadiusEnum = z.enum(["local", "module", "cross_module", "app", "production"]);
export const StatusEnum = z.enum([
  "pending",
  "engineering",
  "verifying",
  "needs_correction",
  "ready_for_pr",
  "pr_open",
  "merged",
  "blocked",
  "escalated",
]);
export const GateEnum = z.enum(["none", "pr", "merge", "phase", "manual"]);
export const VerifierEnum = z.enum(["none", "single", "two-pass"]);
export const GateActorEnum = z.enum(["human", "auto"]);
export const MergeStrategyEnum = z.enum(["squash", "merge", "rebase"]);

export type TicketId = z.infer<typeof TicketIdSchema>;
export type SprintId = z.infer<typeof SprintIdSchema>;
export type Kind = z.infer<typeof KindEnum>;
export type Risk = z.infer<typeof RiskEnum>;
export type ChangeClass = z.infer<typeof ChangeClassEnum>;
export type BlastRadius = z.infer<typeof BlastRadiusEnum>;
export type Status = z.infer<typeof StatusEnum>;
export type Gate = z.infer<typeof GateEnum>;
export type Verifier = z.infer<typeof VerifierEnum>;
export type GateActor = z.infer<typeof GateActorEnum>;
export type MergeStrategy = z.infer<typeof MergeStrategyEnum>;
