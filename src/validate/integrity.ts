import { Code, error, type ValidationFinding } from "./findings.js";
import type { LoadedContract, LoadedSprint } from "./load.js";

/**
 * Integrity stage: pure structural checks over an already-loaded, schema-valid
 * contract. No filesystem, no writes, no mutation of the model. Detects drift,
 * mismatches, missing references, and dependency cycles.
 *
 * The manifest is the machine DAG/index: missing-reference and cycle checks run
 * over manifest entries (what the orchestrator will walk). Manifest/ticket
 * disagreement is caught separately by the sync rules.
 */
export function validateIntegrity(contract: LoadedContract): ValidationFinding[] {
  const knownIds = collectKnownIds(contract);
  return [
    ...duplicateTicketIds(contract),
    ...duplicateManifestEntries(contract),
    ...sprintIdMismatches(contract),
    ...manifestTicketsMissingFiles(contract),
    ...ticketsNotInManifest(contract),
    ...filenameIdMismatches(contract),
    ...missingReferences(contract, knownIds, "depends_on"),
    ...missingReferences(contract, knownIds, "blocks"),
    ...dependencyCycles(contract),
    ...manifestTicketSyncMismatches(contract),
  ];
}

function collectKnownIds(contract: LoadedContract): Set<string> {
  const ids = new Set<string>();
  for (const sprint of contract.sprints) {
    for (const ticket of sprint.tickets) ids.add(ticket.frontMatter.id);
    for (const entry of sprint.manifest.tickets) ids.add(entry.id);
  }
  return ids;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const value of setA) if (!setB.has(value)) return false;
  return true;
}

/** Expected ticket id from a filename, using the canonical id rule: T + >=2 digits, then a delimiter or end. */
function filenamePrefixId(file: string): string | undefined {
  const base = file.split("/").pop() ?? file;
  return /^(T\d{2,})(?:-|\.|$)/.exec(base)?.[1];
}

// Ticket IDs are epic-wide unique in v1 because references are unqualified bare IDs.
// (If Forge later introduces qualified references like sprint-05-foundation/T01, revisit.)
function duplicateTicketIds(contract: LoadedContract): ValidationFinding[] {
  const occurrences = new Map<string, string[]>();
  for (const sprint of contract.sprints) {
    for (const ticket of sprint.tickets) {
      const files = occurrences.get(ticket.frontMatter.id) ?? [];
      files.push(ticket.file);
      occurrences.set(ticket.frontMatter.id, files);
    }
  }

  const findings: ValidationFinding[] = [];
  for (const [id, files] of occurrences) {
    if (files.length > 1) {
      findings.push(
        error(Code.DUPLICATE_TICKET_ID, `ticket id ${id} appears in ${files.length} files: ${files.join(", ")}`, {
          ticket: id,
        }),
      );
    }
  }
  return findings;
}

function duplicateManifestEntries(contract: LoadedContract): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const sprint of contract.sprints) {
    const counts = new Map<string, number>();
    for (const entry of sprint.manifest.tickets) {
      counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
    }
    for (const [id, count] of counts) {
      if (count > 1) {
        findings.push(
          error(Code.DUPLICATE_TICKET_ID, `manifest lists ticket id ${id} ${count} times`, {
            sprint: sprint.id,
            ticket: id,
            file: sprint.manifestFile,
          }),
        );
      }
    }
  }
  return findings;
}

function sprintIdMismatches(contract: LoadedContract): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const sprint of contract.sprints) {
    if (sprint.id !== sprint.manifest.sprint) {
      findings.push(
        error(
          Code.MANIFEST_SPRINT_ID_MISMATCH,
          `epic lists sprint "${sprint.id}" but its manifest declares sprint "${sprint.manifest.sprint}"`,
          { sprint: sprint.id, file: sprint.manifestFile },
        ),
      );
    }
  }
  return findings;
}

function manifestTicketsMissingFiles(contract: LoadedContract): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const sprint of contract.sprints) {
    const ticketIds = new Set(sprint.tickets.map((ticket) => ticket.frontMatter.id));
    for (const entry of sprint.manifest.tickets) {
      if (!ticketIds.has(entry.id)) {
        findings.push(
          error(Code.MANIFEST_TICKET_MISSING_FILE, `manifest lists ticket ${entry.id} but no ticket file declares it`, {
            sprint: sprint.id,
            ticket: entry.id,
            file: sprint.manifestFile,
          }),
        );
      }
    }
  }
  return findings;
}

function ticketsNotInManifest(contract: LoadedContract): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const sprint of contract.sprints) {
    const entryIds = new Set(sprint.manifest.tickets.map((entry) => entry.id));
    for (const ticket of sprint.tickets) {
      if (!entryIds.has(ticket.frontMatter.id)) {
        findings.push(
          error(Code.TICKET_NOT_IN_MANIFEST, `ticket ${ticket.frontMatter.id} is not listed in the sprint manifest`, {
            sprint: sprint.id,
            ticket: ticket.frontMatter.id,
            file: ticket.file,
          }),
        );
      }
    }
  }
  return findings;
}

function filenameIdMismatches(contract: LoadedContract): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const sprint of contract.sprints) {
    for (const ticket of sprint.tickets) {
      const prefix = filenamePrefixId(ticket.file);
      if (prefix !== ticket.frontMatter.id) {
        const detail = prefix ? `is prefixed ${prefix}` : "has no canonical ticket-id prefix";
        findings.push(
          error(
            Code.TICKET_FILENAME_ID_MISMATCH,
            `ticket file ${ticket.file} ${detail} but declares id ${ticket.frontMatter.id}`,
            { sprint: sprint.id, ticket: ticket.frontMatter.id, file: ticket.file },
          ),
        );
      }
    }
  }
  return findings;
}

function missingReferences(
  contract: LoadedContract,
  knownIds: Set<string>,
  field: "depends_on" | "blocks",
): ValidationFinding[] {
  const code = field === "depends_on" ? Code.DEPENDENCY_MISSING : Code.BLOCK_TARGET_MISSING;
  const label = field === "depends_on" ? "dependency" : "block target";
  const findings: ValidationFinding[] = [];

  for (const sprint of contract.sprints) {
    for (const ticket of sprint.tickets) {
      for (const reference of ticket.frontMatter[field]) {
        if (!knownIds.has(reference)) {
          findings.push(
            error(code, `ticket ${ticket.frontMatter.id} references unknown ${label} ${reference}`, {
              sprint: sprint.id,
              ticket: ticket.frontMatter.id,
              file: ticket.file,
            }),
          );
        }
      }
    }
    for (const entry of sprint.manifest.tickets) {
      for (const reference of entry[field]) {
        if (!knownIds.has(reference)) {
          findings.push(
            error(code, `manifest entry ${entry.id} references unknown ${label} ${reference}`, {
              sprint: sprint.id,
              ticket: entry.id,
              file: sprint.manifestFile,
            }),
          );
        }
      }
    }
  }
  return findings;
}

function dependencyCycles(contract: LoadedContract): ValidationFinding[] {
  // The orchestrator walks the manifest, so cycle detection uses manifest depends_on.
  const dependsOn = new Map<string, readonly string[]>();
  const locationById = new Map<string, { sprint: string; file: string }>();
  for (const sprint of contract.sprints) {
    for (const entry of sprint.manifest.tickets) {
      dependsOn.set(entry.id, entry.depends_on);
      if (!locationById.has(entry.id)) {
        locationById.set(entry.id, { sprint: sprint.id, file: sprint.manifestFile });
      }
    }
  }

  const visited = new Set<string>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const seenCycles = new Set<string>();
  const findings: ValidationFinding[] = [];

  function visit(id: string): void {
    visited.add(id);
    onStack.add(id);
    stack.push(id);
    for (const next of dependsOn.get(id) ?? []) {
      if (!dependsOn.has(next)) continue; // missing target — reported elsewhere, not a cycle node
      if (onStack.has(next)) {
        const cycle = stack.slice(stack.indexOf(next));
        const signature = [...cycle].sort().join(",");
        if (!seenCycles.has(signature)) {
          seenCycles.add(signature);
          const location = locationById.get(next) ?? {};
          findings.push(
            error(Code.DEPENDENCY_CYCLE, `dependency cycle detected: ${[...cycle, next].join(" -> ")}`, {
              ...location,
              ticket: next,
            }),
          );
        }
      } else if (!visited.has(next)) {
        visit(next);
      }
    }
    onStack.delete(id);
    stack.pop();
  }

  for (const id of dependsOn.keys()) {
    if (!visited.has(id)) visit(id);
  }
  return findings;
}

function manifestTicketSyncMismatches(contract: LoadedContract): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const sprint of contract.sprints) {
    findings.push(...syncSprint(sprint));
  }
  return findings;
}

function syncSprint(sprint: LoadedSprint): ValidationFinding[] {
  const entryById = new Map(sprint.manifest.tickets.map((entry) => [entry.id, entry]));
  const findings: ValidationFinding[] = [];

  for (const ticket of sprint.tickets) {
    const entry = entryById.get(ticket.frontMatter.id);
    if (!entry) continue;
    const at = { sprint: sprint.id, ticket: ticket.frontMatter.id, file: ticket.file };

    if (entry.kind !== ticket.frontMatter.kind) {
      findings.push(
        error(
          Code.MANIFEST_TICKET_KIND_MISMATCH,
          `kind differs: manifest=${entry.kind} ticket=${ticket.frontMatter.kind}`,
          at,
        ),
      );
    }
    if (entry.status !== ticket.frontMatter.status) {
      findings.push(
        error(
          Code.MANIFEST_TICKET_STATUS_MISMATCH,
          `status differs: manifest=${entry.status} ticket=${ticket.frontMatter.status}`,
          at,
        ),
      );
    }
    if (!sameSet(entry.depends_on, ticket.frontMatter.depends_on)) {
      findings.push(error(Code.MANIFEST_TICKET_DEPENDENCY_MISMATCH, "depends_on differs between manifest and ticket", at));
    }
    if (!sameSet(entry.blocks, ticket.frontMatter.blocks)) {
      findings.push(error(Code.MANIFEST_TICKET_BLOCKS_MISMATCH, "blocks differ between manifest and ticket", at));
    }
  }
  return findings;
}
