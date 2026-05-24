import { z } from "zod";

import {
  BlastRadiusEnum,
  ChangeClassEnum,
  GateEnum,
  KindEnum,
  NonEmptyStringSchema,
  RiskEnum,
  SCHEMA_VERSION,
  StatusEnum,
  TicketIdSchema,
  VerifierEnum,
} from "./enums.js";

/**
 * Local shape + enum correctness for a ticket's YAML front-matter.
 * Cross-file rules (dependency existence, status sync, path overlap,
 * acceptance-section presence, auto-escalation) live in the validator layer.
 */
export const TicketFrontMatterSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    id: TicketIdSchema,
    title: NonEmptyStringSchema,
    kind: KindEnum,
    risk: RiskEnum,
    change_class: ChangeClassEnum,
    blast_radius: BlastRadiusEnum,
    status: StatusEnum,
    depends_on: z.array(TicketIdSchema).default([]),
    blocks: z.array(TicketIdSchema).default([]),
    allowed_paths: z.array(NonEmptyStringSchema).default([]),
    forbidden_paths: z.array(NonEmptyStringSchema).default([]),
    verify_commands: z.array(NonEmptyStringSchema).default([]),
    adrs: z.array(NonEmptyStringSchema).default([]),
    gate: GateEnum,
    gate_override: z.boolean().default(false),
    gate_override_rationale: NonEmptyStringSchema.optional(),
    verifier: VerifierEnum.default("two-pass"),
  })
  .strict()
  .superRefine((ticket, ctx) => {
    if (ticket.gate_override && ticket.gate_override_rationale === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "gate_override is true but gate_override_rationale is missing",
        path: ["gate_override_rationale"],
      });
    }
  });

export type TicketFrontMatter = z.infer<typeof TicketFrontMatterSchema>;
