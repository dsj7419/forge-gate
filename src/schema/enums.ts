import { z } from "zod";

/** The only contract schema version this build understands. */
export const SCHEMA_VERSION = 1;

/** Ticket identifiers: a capital T followed by digits (e.g. T01, T03, T100). */
export const TicketIdSchema = z
  .string()
  .regex(/^T\d+$/, "ticket id must match /^T\\d+$/ (e.g. T03)");

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
export type Kind = z.infer<typeof KindEnum>;
export type Risk = z.infer<typeof RiskEnum>;
export type ChangeClass = z.infer<typeof ChangeClassEnum>;
export type BlastRadius = z.infer<typeof BlastRadiusEnum>;
export type Status = z.infer<typeof StatusEnum>;
export type Gate = z.infer<typeof GateEnum>;
export type Verifier = z.infer<typeof VerifierEnum>;
export type GateActor = z.infer<typeof GateActorEnum>;
export type MergeStrategy = z.infer<typeof MergeStrategyEnum>;
