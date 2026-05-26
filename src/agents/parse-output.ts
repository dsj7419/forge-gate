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
export function parseAgentOutput(role: AgentRole, raw: string): ParseResult<unknown>;
export function parseAgentOutput(role: AgentRole, raw: string): ParseResult<unknown> {
  // Accept either plain YAML or exactly one ```yaml fenced block (agents often wrap
  // output in a fence with surrounding prose). Extraction is deterministic and never
  // repairs: 0 yaml fences → parse the whole string (unchanged); exactly 1 → parse its
  // contents; ≥2 → invalid (ambiguous). Non-YAML code fences (```json, etc.) are ignored.
  const yamlBlocks = extractYamlFencedBlocks(raw);
  if (yamlBlocks.length > 1) {
    return fail(["multiple ```yaml fenced blocks found; emit exactly one YAML object or a single ```yaml fenced block"]);
  }
  const source = yamlBlocks.length === 1 ? (yamlBlocks[0] ?? raw) : raw;

  let data: unknown;
  try {
    data = parseYaml(source);
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

const FENCE_OPEN = /^\s*```\s*([A-Za-z0-9_-]*)\s*$/;
const FENCE_CLOSE = /^\s*```\s*$/;

/**
 * Return the inner contents of every ```yaml / ```yml fenced code block in `raw`.
 * Non-YAML fences (```json, ```bash, untagged ```) are tracked so their closing
 * fence is not mis-paired, but are not returned. Deterministic; no repair.
 */
function extractYamlFencedBlocks(raw: string): string[] {
  const blocks: string[] = [];
  let inFence = false;
  let isYaml = false;
  let buffer: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!inFence) {
      const open = FENCE_OPEN.exec(line);
      if (open) {
        inFence = true;
        isYaml = /^ya?ml$/i.test(open[1] ?? "");
        buffer = [];
      }
      continue;
    }
    if (FENCE_CLOSE.test(line)) {
      if (isYaml) blocks.push(buffer.join("\n"));
      inFence = false;
      isYaml = false;
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  return blocks;
}
