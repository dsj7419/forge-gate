import { z } from "zod";

import {
  BlastRadiusEnum,
  ChangeClassEnum,
  GateEnum,
  KindEnum,
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
    title: z.string().min(1),
    kind: KindEnum,
    risk: RiskEnum,
    change_class: ChangeClassEnum,
    blast_radius: BlastRadiusEnum,
    status: StatusEnum,
    depends_on: z.array(TicketIdSchema).default([]),
    blocks: z.array(TicketIdSchema).default([]),
    allowed_paths: z.array(z.string()).default([]),
    forbidden_paths: z.array(z.string()).default([]),
    verify_commands: z.array(z.string()).default([]),
    adrs: z.array(z.string()).default([]),
    gate: GateEnum,
    gate_override: z.boolean().default(false),
    verifier: VerifierEnum.default("two-pass"),
  })
  .strict();

export type TicketFrontMatter = z.infer<typeof TicketFrontMatterSchema>;
