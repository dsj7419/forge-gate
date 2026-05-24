import { z } from "zod";

import { SCHEMA_VERSION } from "./enums.js";
import { GatePolicySchema } from "./gate-policy.js";

/** Top-level epic index: ordered sprints + the global default gate policy. */
export const EpicSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    id: z.string().min(1),
    title: z.string().min(1).optional(),
    sprints: z.array(z.string().min(1)),
    gate_policy: GatePolicySchema,
  })
  .strict();

export type Epic = z.infer<typeof EpicSchema>;
