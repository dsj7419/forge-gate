import { z } from "zod";

import { NonEmptyStringSchema, SCHEMA_VERSION, SprintIdSchema } from "./enums.js";
import { GatePolicySchema } from "./gate-policy.js";

/** Top-level epic index: ordered sprints + the global default gate policy. */
export const EpicSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema.optional(),
    sprints: z.array(SprintIdSchema),
    gate_policy: GatePolicySchema,
  })
  .strict();

export type Epic = z.infer<typeof EpicSchema>;
