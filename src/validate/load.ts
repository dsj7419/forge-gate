import * as fs from "node:fs";
import * as path from "node:path";

import { parse as parseYaml } from "yaml";
import type { ZodError } from "zod";

import { parseFrontMatter } from "../fs/front-matter.js";
import { EpicSchema, type Epic } from "../schema/epic.js";
import { ManifestSchema, type Manifest } from "../schema/manifest.js";
import { TicketFrontMatterSchema, type TicketFrontMatter } from "../schema/ticket.js";
import { Code, error, type ValidationFinding } from "./findings.js";

export type LoadedTicket = {
  /** Path relative to the epic root, posix-style (e.g. sprint-05-foundation/tickets/T01.md). */
  file: string;
  frontMatter: TicketFrontMatter;
  body: string;
};

export type LoadedSprint = {
  /** Sprint id as declared in epic.sprints (the folder name). */
  id: string;
  /** Path relative to the epic root, posix-style. */
  manifestFile: string;
  manifest: Manifest;
  tickets: LoadedTicket[];
};

export type LoadedContract = {
  epicPath: string;
  /** Path relative to the epic root, posix-style (always "epic.yaml"). */
  epicFile: string;
  epic: Epic;
  sprints: LoadedSprint[];
};

export type LoadResult = {
  contract?: LoadedContract;
  findings: ValidationFinding[];
};

/** Epic-rooted, posix-style relative path — portable across machines and in committed reports. */
function toRelative(epicPath: string, file: string): string {
  return path.relative(epicPath, file).split(path.sep).join("/");
}

function describeError(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

function describeIssues(zodError: ZodError): string {
  return zodError.issues
    .map((issue) => {
      const at = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${at}${issue.message}`;
    })
    .join("; ");
}

function readFileSafe(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function loadTickets(
  epicPath: string,
  sprintId: string,
  ticketsDir: string,
  findings: ValidationFinding[],
): LoadedTicket[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(ticketsDir);
  } catch {
    findings.push(
      error(Code.TICKETS_DIR_MISSING, `tickets directory not found for sprint ${sprintId}`, {
        sprint: sprintId,
        file: toRelative(epicPath, ticketsDir),
      }),
    );
    return [];
  }

  const files = entries
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => path.join(ticketsDir, name));

  const tickets: LoadedTicket[] = [];
  for (const absFile of files) {
    const text = readFileSafe(absFile);
    if (text === undefined) continue;
    const relFile = toRelative(epicPath, absFile);

    const frontMatter = parseFrontMatter(text);
    if (!frontMatter.ok) {
      findings.push(
        error(Code.TICKET_FRONT_MATTER_INVALID, `ticket front-matter could not be parsed: ${frontMatter.error}`, {
          file: relFile,
          sprint: sprintId,
        }),
      );
      continue;
    }

    const parsed = TicketFrontMatterSchema.safeParse(frontMatter.data);
    if (!parsed.success) {
      findings.push(
        error(Code.TICKET_SCHEMA_INVALID, `ticket front-matter failed schema: ${describeIssues(parsed.error)}`, {
          file: relFile,
          sprint: sprintId,
        }),
      );
      continue;
    }

    tickets.push({ file: relFile, frontMatter: parsed.data, body: frontMatter.body });
  }
  return tickets;
}

function loadSprint(
  epicPath: string,
  sprintId: string,
  findings: ValidationFinding[],
): LoadedSprint | undefined {
  const sprintDir = path.join(epicPath, sprintId);
  const manifestAbs = path.join(sprintDir, "manifest.yaml");
  const manifestFile = toRelative(epicPath, manifestAbs);

  const manifestText = readFileSafe(manifestAbs);
  if (manifestText === undefined) {
    findings.push(
      error(Code.MANIFEST_FILE_MISSING, `manifest.yaml not found for sprint ${sprintId}`, {
        file: manifestFile,
        sprint: sprintId,
      }),
    );
    return undefined;
  }

  let manifestData: unknown;
  try {
    manifestData = parseYaml(manifestText);
  } catch (thrown) {
    findings.push(
      error(Code.MANIFEST_SCHEMA_INVALID, `manifest.yaml is not valid YAML: ${describeError(thrown)}`, {
        file: manifestFile,
        sprint: sprintId,
      }),
    );
    return undefined;
  }

  const parsed = ManifestSchema.safeParse(manifestData);
  if (!parsed.success) {
    findings.push(
      error(Code.MANIFEST_SCHEMA_INVALID, `manifest.yaml failed schema: ${describeIssues(parsed.error)}`, {
        file: manifestFile,
        sprint: sprintId,
      }),
    );
    return undefined;
  }

  const tickets = loadTickets(epicPath, sprintId, path.join(sprintDir, "tickets"), findings);
  return { id: sprintId, manifestFile, manifest: parsed.data, tickets };
}

/**
 * Load stage: locate and parse epic.yaml, each sprint manifest, and ticket
 * markdown, applying the Zod schemas. Returns a typed in-memory contract plus
 * structured findings. Never throws on bad project input — every problem
 * becomes a ValidationFinding. Writes nothing. Finding paths are epic-relative.
 */
export function loadContract(epicPath: string): LoadResult {
  const findings: ValidationFinding[] = [];
  const epicAbs = path.join(epicPath, "epic.yaml");
  const epicFile = toRelative(epicPath, epicAbs);

  const epicText = readFileSafe(epicAbs);
  if (epicText === undefined) {
    findings.push(error(Code.EPIC_FILE_MISSING, `epic.yaml not found at ${epicFile}`, { file: epicFile }));
    return { findings };
  }

  let epicData: unknown;
  try {
    epicData = parseYaml(epicText);
  } catch (thrown) {
    findings.push(
      error(Code.EPIC_SCHEMA_INVALID, `epic.yaml is not valid YAML: ${describeError(thrown)}`, { file: epicFile }),
    );
    return { findings };
  }

  const parsed = EpicSchema.safeParse(epicData);
  if (!parsed.success) {
    findings.push(
      error(Code.EPIC_SCHEMA_INVALID, `epic.yaml failed schema: ${describeIssues(parsed.error)}`, { file: epicFile }),
    );
    return { findings };
  }

  const sprints: LoadedSprint[] = [];
  for (const sprintId of parsed.data.sprints) {
    const sprint = loadSprint(epicPath, sprintId, findings);
    if (sprint) sprints.push(sprint);
  }

  return { contract: { epicPath, epicFile, epic: parsed.data, sprints }, findings };
}
