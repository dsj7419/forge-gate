import { z } from "zod";

import { KindEnum, SCHEMA_VERSION, StatusEnum, TicketIdSchema } from "./enums.js";
import { GatePolicySchema } from "./gate-policy.js";

/** A manifest's per-ticket index row (the machine-readable DAG node). */
export const ManifestTicketEntrySchema = z
  .object({
    id: TicketIdSchema,
    kind: KindEnum,
    depends_on: z.array(TicketIdSchema).default([]),
    status: StatusEnum,
  })
  .strict();

export const ManifestSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    sprint: z.string().min(1),
    integration_base: z.string().min(1).default("main"),
    gate_policy: GatePolicySchema,
    tickets: z.array(ManifestTicketEntrySchema),
  })
  .strict();

export type ManifestTicketEntry = z.infer<typeof ManifestTicketEntrySchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
