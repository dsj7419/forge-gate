import { parse as parseYaml } from "yaml";
import { z } from "zod";

import {
  EngineerOutputSchema,
  PMOutputSchema,
  ScopeVerifierOutputSchema,
  SemanticVerifierOutputSchema,
  type EngineerOutput,
  type PMOutput,
  type ScopeVerifierOutput,
  type SemanticVerifierOutput,
} from "./schemas.js";

export type AgentRole = "engineer" | "semantic-verifier" | "scope-verifier" | "pm";

export type ParseResult<T> = { ok: true; data: T } | { ok: false; code: "AGENT_OUTPUT_INVALID"; errors: string[] };

const SCHEMAS: Record<AgentRole, z.ZodTypeAny> = {
  engineer: EngineerOutputSchema,
  "semantic-verifier": SemanticVerifierOutputSchema,
  "scope-verifier": ScopeVerifierOutputSchema,
  pm: PMOutputSchema,
};

function fail(errors: string[]): { ok: false; code: "AGENT_OUTPUT_INVALID"; errors: string[] } {
  return { ok: false, code: "AGENT_OUTPUT_INVALID", errors };
}

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const at = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${at}${issue.message}`;
  });
}

/**
 * Parse and validate an agent's YAML output against its schema. The orchestrator
 * must call this before acting on any agent response — it never infers or repairs
 * missing fields, and rejects scalar/prose-only output. Any problem yields a
 * structured AGENT_OUTPUT_INVALID failure (never a guess).
 */
export function parseAgentOutput(role: "engineer", raw: string): ParseResult<EngineerOutput>;
export function parseAgentOutput(role: "semantic-verifier", raw: string): ParseResult<SemanticVerifierOutput>;
export function parseAgentOutput(role: "scope-verifier", raw: string): ParseResult<ScopeVerifierOutput>;
export function parseAgentOutput(role: "pm", raw: string): ParseResult<PMOutput>;
export function parseAgentOutput(role: AgentRole, raw: string): ParseResult<unknown> {
  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (thrown) {
    return fail([`malformed YAML: ${thrown instanceof Error ? thrown.message : String(thrown)}`]);
  }

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return fail(["agent output must be a YAML object (a scalar or prose-only response is rejected)"]);
  }

  const parsed = SCHEMAS[role].safeParse(data);
  if (!parsed.success) return fail(describeIssues(parsed.error));
  return { ok: true, data: parsed.data };
}
