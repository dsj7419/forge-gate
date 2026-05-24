import type { LoadedTicket } from "./load.js";

/** change_class values that always require escalation to a manual gate. */
export const HIGH_RISK_CHANGE_CLASSES = new Set(["migration", "security", "infra", "dependency"]);

/** Conservative, word-boundary keyword heuristics for high-risk surfaces. */
const HIGH_RISK_PATTERNS: RegExp[] = [
  /\bauth\b/i,
  /\bsecrets?\b/i,
  /\.env\b/i,
  /\bproduction\b/i,
  /\bprod\b/i,
  /\bdelete\b/i,
  /\bremove\b/i,
  /rm\s+-rf/i,
  /\bmigrations?\b/i,
];

function ticketHaystack(ticket: LoadedTicket): string {
  const fm = ticket.frontMatter;
  return [fm.title, ticket.body, ...fm.allowed_paths, ...fm.forbidden_paths, ...fm.verify_commands].join("\n");
}

/**
 * Single source of truth for "does this ticket require escalation?", shared by
 * the readiness validator and the run planner so the two cannot drift.
 * Returns a human-readable reason, or undefined when no escalation is required.
 */
export function escalationReason(ticket: LoadedTicket): string | undefined {
  if (HIGH_RISK_CHANGE_CLASSES.has(ticket.frontMatter.change_class)) {
    return `change_class=${ticket.frontMatter.change_class}`;
  }
  const haystack = ticketHaystack(ticket);
  for (const pattern of HIGH_RISK_PATTERNS) {
    const keyword = pattern.exec(haystack)?.[0];
    if (keyword) return `matched high-risk keyword "${keyword}"`;
  }
  return undefined;
}

/** A ticket is adequately gated for high-risk work if it is manual or has a recorded override. */
export function isAdequatelyGated(ticket: LoadedTicket): boolean {
  // Schema guarantees a rationale exists whenever gate_override is true.
  return ticket.frontMatter.gate === "manual" || ticket.frontMatter.gate_override;
}
