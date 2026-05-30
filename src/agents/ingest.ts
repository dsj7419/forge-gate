import { parseAgentOutput, validateRole, type ParseResult } from "./parse-output.js";
import type {
  AgentRole,
  EngineerOutput,
  PMOutput,
  ScopeVerifierOutput,
  SemanticVerifierOutput,
} from "./schemas.js";

/**
 * A source-agnostic agent-output source. `structured` carries an already-decoded
 * object (the future workflow `agent({schema})` output); `yaml` carries the raw
 * text emitted under the existing charter fallback. Both route through the same
 * role-schema validation and return the same ParseResult shape.
 */
export type AgentOutputSource =
  | { source: "structured"; value: unknown }
  | { source: "yaml"; text: string };

/**
 * Validate an agent's output from either a structured object or YAML text, against
 * the role's schema — one source of truth, no duplicate schema logic, never repaired.
 *
 * - `yaml` delegates to parseAgentOutput (fence extraction + safeParse).
 * - `structured` guards that the value is a non-null, non-array object (mirroring the
 *   YAML scalar rejection), then runs the same role safeParse via validateRole.
 *
 * Core Zod validation stays authoritative on both paths: structured output constrains
 * shape/enums/extra-keys only, so refinements, patterns, non-emptiness, and numeric
 * bounds are enforced here regardless of source.
 */
export function ingestAgentOutput(role: "engineer", source: AgentOutputSource): ParseResult<EngineerOutput>;
export function ingestAgentOutput(role: "semantic-verifier", source: AgentOutputSource): ParseResult<SemanticVerifierOutput>;
export function ingestAgentOutput(role: "scope-verifier", source: AgentOutputSource): ParseResult<ScopeVerifierOutput>;
export function ingestAgentOutput(role: "pm", source: AgentOutputSource): ParseResult<PMOutput>;
export function ingestAgentOutput(role: AgentRole, source: AgentOutputSource): ParseResult<unknown>;
export function ingestAgentOutput(role: AgentRole, source: AgentOutputSource): ParseResult<unknown> {
  if (source.source === "yaml") {
    return parseAgentOutput(role, source.text);
  }
  const { value } = source;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      code: "AGENT_OUTPUT_INVALID",
      errors: ["agent output must be an object (a scalar or array structured value is rejected)"],
    };
  }
  return validateRole(role, value);
}
