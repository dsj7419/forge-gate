import { z } from "zod";

import {
  KindEnum,
  NonEmptyStringSchema,
  SCHEMA_VERSION,
  SprintIdSchema,
  StatusEnum,
  TicketIdSchema,
} from "./enums.js";
import { GatePolicySchema } from "./gate-policy.js";

/** A manifest's per-ticket index row (a node in the machine-readable DAG). */
export const ManifestTicketEntrySchema = z
  .object({
    id: TicketIdSchema,
    kind: KindEnum,
    depends_on: z.array(TicketIdSchema).default([]),
    blocks: z.array(TicketIdSchema).default([]),
    status: StatusEnum,
  })
  .strict();

/** An executable sprint manifest. Must carry at least one ticket. */
export const ManifestSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    sprint: SprintIdSchema,
    integration_base: NonEmptyStringSchema.default("main"),
    gate_policy: GatePolicySchema,
    tickets: z.array(ManifestTicketEntrySchema).min(1),
  })
  .strict();

export type ManifestTicketEntry = z.infer<typeof ManifestTicketEntrySchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
