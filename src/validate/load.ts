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
  file: string;
  frontMatter: TicketFrontMatter;
  body: string;
};

export type LoadedSprint = {
  id: string;
  manifestFile: string;
  manifest: Manifest;
  tickets: LoadedTicket[];
};

export type LoadedContract = {
  epicPath: string;
  epicFile: string;
  epic: Epic;
  sprints: LoadedSprint[];
};

export type LoadResult = {
  contract?: LoadedContract;
  findings: ValidationFinding[];
};

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

function listMarkdownFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => path.join(dir, name));
}

function loadTickets(ticketsDir: string, findings: ValidationFinding[]): LoadedTicket[] {
  const tickets: LoadedTicket[] = [];
  for (const file of listMarkdownFiles(ticketsDir)) {
    const text = readFileSafe(file);
    if (text === undefined) continue;

    const frontMatter = parseFrontMatter(text);
    if (!frontMatter.ok) {
      findings.push(
        error(Code.TICKET_FRONT_MATTER_INVALID, `ticket front-matter could not be parsed: ${frontMatter.error}`, {
          file,
        }),
      );
      continue;
    }

    const parsed = TicketFrontMatterSchema.safeParse(frontMatter.data);
    if (!parsed.success) {
      findings.push(
        error(Code.TICKET_SCHEMA_INVALID, `ticket front-matter failed schema: ${describeIssues(parsed.error)}`, {
          file,
        }),
      );
      continue;
    }

    tickets.push({ file, frontMatter: parsed.data, body: frontMatter.body });
  }
  return tickets;
}

function loadSprint(
  epicPath: string,
  sprintId: string,
  findings: ValidationFinding[],
): LoadedSprint | undefined {
  const sprintDir = path.join(epicPath, sprintId);
  const manifestFile = path.join(sprintDir, "manifest.yaml");

  const manifestText = readFileSafe(manifestFile);
  if (manifestText === undefined) {
    findings.push(
      error(Code.MANIFEST_FILE_MISSING, `manifest.yaml not found for sprint ${sprintId}`, { file: manifestFile }),
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
      }),
    );
    return undefined;
  }

  const parsed = ManifestSchema.safeParse(manifestData);
  if (!parsed.success) {
    findings.push(
      error(Code.MANIFEST_SCHEMA_INVALID, `manifest.yaml failed schema: ${describeIssues(parsed.error)}`, {
        file: manifestFile,
      }),
    );
    return undefined;
  }

  const tickets = loadTickets(path.join(sprintDir, "tickets"), findings);
  return { id: sprintId, manifestFile, manifest: parsed.data, tickets };
}

/**
 * Load stage: locate and parse epic.yaml, each sprint manifest, and ticket
 * markdown, applying the Zod schemas. Returns a typed in-memory contract plus
 * structured findings. Never throws on bad project input — every problem
 * becomes a ValidationFinding. Writes nothing.
 */
export function loadContract(epicPath: string): LoadResult {
  const findings: ValidationFinding[] = [];
  const epicFile = path.join(epicPath, "epic.yaml");

  const epicText = readFileSafe(epicFile);
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
