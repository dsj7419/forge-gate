import type { DerivedTicket } from "./plan.js";

const HUMAN_GATE_POLICY_YAML = ["gate_policy:", "  default_push: human", "  default_merge: human"];

/** Placeholder written for canonical fields that were ambiguous in the legacy source. */
const TODO = "TODO";

export function generateEpicYaml(epicId: string, sprintId: string): string {
  return [
    "schema_version: 1",
    `id: ${epicId}`,
    "sprints:",
    `  - ${sprintId}`,
    ...HUMAN_GATE_POLICY_YAML,
    "",
  ].join("\n");
}

export function generateManifestYaml(sprintId: string, entries: Array<{ id: string; kind: string }>): string {
  const ticketLines = entries.flatMap((entry) => [`  - id: ${entry.id}`, `    kind: ${entry.kind}`, "    status: pending"]);
  return [
    "schema_version: 1",
    `sprint: ${sprintId}`,
    ...HUMAN_GATE_POLICY_YAML,
    "tickets:",
    ...ticketLines,
    "",
  ].join("\n");
}

/**
 * Generate a canonical ticket file from a derived legacy ticket.
 *
 * Import-draft semantics: when a required canonical field was ambiguous in the
 * legacy source, this writes a `TODO` placeholder rather than inventing a value.
 * That makes the generated front-matter intentionally fail schema validation
 * until a human completes it — the output is a human-completion draft, not
 * execution-ready Forge input. (Design debt: a future "valid-but-blocked"
 * model — e.g. status: blocked + gate: manual — would avoid invalid YAML.)
 */
export function generateTicketMd(ticket: DerivedTicket): string {
  const frontMatter = [
    "---",
    "schema_version: 1",
    `id: ${ticket.idAmbiguous ? TODO : ticket.id}`,
    `title: ${JSON.stringify(ticket.title)}`,
    `kind: ${ticket.kind ?? TODO}`,
    `risk: ${ticket.risk ?? TODO}`,
    `change_class: ${ticket.change_class ?? TODO}`,
    `blast_radius: ${ticket.blast_radius ?? TODO}`,
    "status: pending",
    "gate: pr",
    "gate_override: false",
    "verify_commands: []",
    "---",
  ].join("\n");
  return `${frontMatter}\n${ticket.body}`;
}

export function generateSprintMd(overview: string | undefined): string {
  const preserved = overview ?? "_No legacy sprint overview was found; complete this section._";
  return `# Sprint\n\n${preserved}\n`;
}

export function generateDecisionsMd(decisions: string | undefined): string {
  const preserved = decisions ?? "_No legacy decisions were found._";
  return `# Decisions\n\n${preserved}\n`;
}

export function generateEpicMd(epicId: string, sprintId: string): string {
  return [
    `# Epic: ${epicId}`,
    "",
    "Imported from legacy sprint material. Review the goal, scope, non-goals, and constraints.",
    "",
    `Sprints: ${sprintId}`,
    "",
  ].join("\n");
}

export function generateJournalMd(): string {
  return "# Journal\n\nImported. This journal is append-only.\n";
}
