import * as fs from "node:fs";
import * as path from "node:path";

import { z } from "zod";

import { GuardCode, type GuardCodeValue, type GuardFence } from "./path-guard.js";

export const ACTIVE_TICKET_SCHEMA = "forge-active-ticket/v1";

/**
 * The cross-process active-ticket contract a run writes to gitignored
 * `.forge/active-ticket.json` and the guard reads back.
 *
 * Deliberately NOT `.strict()` (the one considered exception to the project's
 * strict-everywhere rule): the orchestration shell also records operational fields
 * (gate, phase, timestamp, epic, sprint) the guard ignores. Tolerating and
 * stripping unknown keys keeps this a forward-compatible producer/consumer
 * boundary. Missing *required* fields still fail loudly — never silently accepted.
 */
export const ActiveTicketSchema = z.object({
  schema: z.literal(ACTIVE_TICKET_SCHEMA),
  // Must be absolute: the guard rejects wrong-cwd evidence by comparing the worktree
  // root to this value. A relative repo_root would resolve against the guard's own
  // cwd and silently defeat that check (ForgeGate's #1 durable lesson).
  repo_root: z.string().min(1).refine((value) => path.isAbsolute(value), "repo_root must be an absolute path"),
  epic_path: z.string().min(1).optional(),
  ticket: z.string().min(1),
  branch: z.string().min(1).optional(),
  allowed_paths: z.array(z.string()),
  forbidden_paths: z.array(z.string()),
  protected_paths: z.array(z.string()),
});

export type ActiveTicket = z.infer<typeof ActiveTicketSchema>;

export type ActiveTicketResult =
  | { ok: true; ticket: ActiveTicket }
  | { ok: false; code: GuardCodeValue; message: string };

/** Parse + validate active-ticket JSON. Pure: no IO. */
export function parseActiveTicket(raw: string): ActiveTicketResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (thrown) {
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    return { ok: false, code: GuardCode.ACTIVE_TICKET_INVALID, message: `active-ticket is not valid JSON: ${detail}` };
  }
  const parsed = ActiveTicketSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, code: GuardCode.ACTIVE_TICKET_INVALID, message: formatIssues(parsed.error) };
  }
  return { ok: true, ticket: parsed.data };
}

export type ReadFile = (path: string) => string;

const defaultReadFile: ReadFile = (path) => fs.readFileSync(path, "utf8");

/** Read + parse the active-ticket file. Missing file → ACTIVE_TICKET_MISSING; anything else delegates to {@link parseActiveTicket}. */
export function loadActiveTicket(activePath: string, readFile: ReadFile = defaultReadFile): ActiveTicketResult {
  let raw: string;
  try {
    raw = readFile(activePath);
  } catch (thrown) {
    if (isErrno(thrown) && thrown.code === "ENOENT") {
      return { ok: false, code: GuardCode.ACTIVE_TICKET_MISSING, message: `active-ticket file not found: ${activePath}` };
    }
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    return { ok: false, code: GuardCode.ACTIVE_TICKET_INVALID, message: `active-ticket file unreadable: ${detail}` };
  }
  return parseActiveTicket(raw);
}

/** Narrow an active ticket down to just the fence the evaluator needs. */
export function fenceOf(ticket: ActiveTicket): GuardFence {
  return {
    repo_root: ticket.repo_root,
    allowed_paths: ticket.allowed_paths,
    forbidden_paths: ticket.forbidden_paths,
    protected_paths: ticket.protected_paths,
  };
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const at = issue.path.join(".");
      return at.length > 0 ? `${at}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

function isErrno(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
