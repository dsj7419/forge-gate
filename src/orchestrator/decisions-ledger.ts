import { z } from "zod";

import { NonEmptyStringSchema, TicketIdSchema } from "../schema/enums.js";

/**
 * Per-epic decisions ledger (`$EPIC/.forge/decisions-ledger.json`) — the
 * runtime-only, gitignored record of every PM decision Core has authorized
 * for this epic. Used to compute the next monotonic `decision_id`.
 *
 * The ledger lives under `.forge/` alongside `lock.json` and
 * `active-ticket.json`. It is deliberately small: a Zod-validated reader and
 * a single appender behind an injected IO seam. This module never grows into
 * a general-purpose run-report writer.
 */

const DecisionIdSchema = z
  .string()
  .regex(/^D-\d+$/, "decision_id must match D-<digits> (e.g. D-001)");

export const LedgerEntrySchema = z
  .object({
    decision_id: DecisionIdSchema,
    ticket: TicketIdSchema,
    branch: NonEmptyStringSchema,
    ts: NonEmptyStringSchema,
  })
  .strict();

export const DecisionsLedgerSchema = z
  .object({ decisions: z.array(LedgerEntrySchema) })
  .strict();

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export type DecisionsLedger = z.infer<typeof DecisionsLedgerSchema>;

/**
 * The only filesystem seam: read the ledger file (or signal absence with
 * `null`) and write its full contents back. Mirrors `InstallReader`'s
 * single-purpose IO interface so tests run against in-memory state.
 */
export type DecisionsLedgerIo = {
  /** Returns the file's UTF-8 contents or `null` if it does not exist. */
  readFileIfExists: (file: string) => string | null;
  /** Writes the file's UTF-8 contents (caller is responsible for atomicity). */
  writeFile: (file: string, contents: string) => void;
};

export type ReadLedgerResult =
  | { ok: true; ledger: DecisionsLedger }
  | { ok: false; code: "LEDGER_INVALID"; errors: string[] };

export type AppendLedgerResult =
  | { ok: true; ledger: DecisionsLedger }
  | { ok: false; code: "LEDGER_INVALID" | "LEDGER_ENTRY_INVALID"; errors: string[] };

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const at = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${at}${issue.message}`;
  });
}

/**
 * Read the ledger file. Missing file → an empty ledger (success). Any other
 * problem (malformed JSON, wrong shape) is a typed `LEDGER_INVALID` failure —
 * never a silent empty, so an upstream bug cannot quietly recycle ids.
 */
export function readDecisionsLedger(file: string, io: DecisionsLedgerIo): ReadLedgerResult {
  const contents = io.readFileIfExists(file);
  if (contents === null) return { ok: true, ledger: { decisions: [] } };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(contents);
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return { ok: false, code: "LEDGER_INVALID", errors: [`malformed JSON: ${message}`] };
  }

  const parsed = DecisionsLedgerSchema.safeParse(parsedJson);
  if (!parsed.success) return { ok: false, code: "LEDGER_INVALID", errors: describeIssues(parsed.error) };
  return { ok: true, ledger: parsed.data };
}

/**
 * Append one entry to the ledger and write the full file back. Validates both
 * the existing file (refuses to clobber a malformed ledger) and the new entry
 * (rejects an ill-shaped entry before writing). Returns the post-write ledger
 * on success.
 */
export function appendDecision(
  file: string,
  entry: LedgerEntry,
  io: DecisionsLedgerIo,
): AppendLedgerResult {
  const entryParsed = LedgerEntrySchema.safeParse(entry);
  if (!entryParsed.success) {
    return { ok: false, code: "LEDGER_ENTRY_INVALID", errors: describeIssues(entryParsed.error) };
  }

  const current = readDecisionsLedger(file, io);
  if (!current.ok) return current;

  const next: DecisionsLedger = { decisions: [...current.ledger.decisions, entryParsed.data] };
  io.writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
  return { ok: true, ledger: next };
}
