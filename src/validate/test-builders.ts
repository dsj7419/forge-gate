// Test-only builders for constructing in-memory LoadedContract values.
// Integrity/readiness stages are pure, so their tests need no disk fixtures.
// Builders run the real Zod schemas so every built value is schema-valid.

import { ManifestSchema, ManifestTicketEntrySchema, type ManifestTicketEntry } from "../schema/manifest.js";
import { EpicSchema } from "../schema/epic.js";
import { TicketFrontMatterSchema } from "../schema/ticket.js";
import type { LoadedContract, LoadedSprint, LoadedTicket } from "./load.js";

export function makeTicket(
  front: Record<string, unknown> = {},
  opts: { file?: string; body?: string } = {},
): LoadedTicket {
  const frontMatter = TicketFrontMatterSchema.parse({
    schema_version: 1,
    id: "T01",
    title: "Ticket",
    kind: "green",
    risk: "low",
    change_class: "feature",
    blast_radius: "module",
    status: "pending",
    gate: "pr",
    verify_commands: ["echo verify"],
    ...front,
  });
  return {
    file: opts.file ?? `sprint-05-foundation/tickets/${frontMatter.id}-x.md`,
    frontMatter,
    body: opts.body ?? "## Acceptance Criteria\n\n- [ ] x\n",
  };
}

export function makeEntry(entry: Record<string, unknown> = {}): ManifestTicketEntry {
  return ManifestTicketEntrySchema.parse({ id: "T01", kind: "green", status: "pending", ...entry });
}

function entryFromTicket(ticket: LoadedTicket): ManifestTicketEntry {
  return makeEntry({
    id: ticket.frontMatter.id,
    kind: ticket.frontMatter.kind,
    status: ticket.frontMatter.status,
    depends_on: ticket.frontMatter.depends_on,
    blocks: ticket.frontMatter.blocks,
  });
}

const HUMAN_GATE_POLICY = { default_push: "human", default_merge: "human" } as const;

export function makeSprint(opts: {
  id?: string;
  manifestSprint?: string;
  tickets?: LoadedTicket[];
  entries?: ManifestTicketEntry[];
  gatePolicy?: Record<string, unknown>;
} = {}): LoadedSprint {
  const id = opts.id ?? "sprint-05-foundation";
  const tickets = opts.tickets ?? [makeTicket()];
  const entries = opts.entries ?? tickets.map(entryFromTicket);
  const manifest = ManifestSchema.parse({
    schema_version: 1,
    sprint: opts.manifestSprint ?? id,
    gate_policy: opts.gatePolicy ?? HUMAN_GATE_POLICY,
    tickets: entries.length > 0 ? entries : [makeEntry()],
  });
  return { id, manifestFile: `${id}/manifest.yaml`, manifest, tickets };
}

export function makeContract(opts: { sprints?: LoadedSprint[]; gatePolicy?: Record<string, unknown> } = {}): LoadedContract {
  const sprints = opts.sprints ?? [makeSprint()];
  const epic = EpicSchema.parse({
    schema_version: 1,
    id: "demo-epic",
    sprints: sprints.map((sprint) => sprint.id),
    gate_policy: opts.gatePolicy ?? HUMAN_GATE_POLICY,
  });
  return { epicPath: "/virtual/epic", epicFile: "epic.yaml", epic, sprints };
}
