import { z } from "zod";

import { GateActorEnum, MergeStrategyEnum } from "./enums.js";

/** Default push/merge approval policy shared by epics and sprint manifests. */
export const GatePolicySchema = z
  .object({
    default_push: GateActorEnum,
    default_merge: GateActorEnum,
    merge_strategy: MergeStrategyEnum.default("squash"),
  })
  .strict();

export type GatePolicy = z.infer<typeof GatePolicySchema>;
