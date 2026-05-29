import { z } from "zod";

import { nextDecisionId } from "./decision-id.js";
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

function decisionIdValue(id: string): number {
  // Entries already match `D-<digits>` via LedgerEntrySchema, so the prefix
  // strip and parse are safe here.
  return Number.parseInt(id.slice(2), 10);
}

export const DecisionsLedgerSchema = z
  .object({ decisions: z.array(LedgerEntrySchema) })
  .strict()
  // Sequence-integrity read layer: decision ids within one active ledger must
  // be unique and strictly increasing by numeric value in ledger order. A gap
  // (e.g. D-001, D-003) is tolerated on read — this is a structural sanity
  // check only, so an already-on-disk ledger stays readable.
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    let previous: number | null = null;
    value.decisions.forEach((entry, index) => {
      if (seen.has(entry.decision_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisions", index, "decision_id"],
          message: `duplicate decision id ${entry.decision_id} — decision ids must be unique`,
        });
      }
      seen.add(entry.decision_id);

      const current = decisionIdValue(entry.decision_id);
      if (previous !== null && current <= previous) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisions", index, "decision_id"],
          message: `out-of-order decision id ${entry.decision_id} — decision ids must strictly increase in ledger order`,
        });
      }
      previous = current;
    });
  });

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
  | {
      ok: false;
      // LEDGER_SEQUENCE_INVALID covers the full append sequence-integrity rule:
      // a repeated id, a lower-than-next id, and a higher-than-next (gap) id are
      // all rejected, because the appended id must equal nextDecisionId(existing).
      code: "LEDGER_INVALID" | "LEDGER_ENTRY_INVALID" | "LEDGER_SEQUENCE_INVALID";
      errors: string[];
    };

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

  // Verify the proposed id against Core's own deterministic allocator at the
  // write boundary: it must equal the next id computed from the current
  // ledger's ids. This rejects repeated, lower-than-next, and higher-than-next
  // (gap) ids with no write.
  const expected = nextDecisionId(current.ledger.decisions.map((d) => d.decision_id));
  if (entryParsed.data.decision_id !== expected) {
    return {
      ok: false,
      code: "LEDGER_SEQUENCE_INVALID",
      errors: [
        `decision_id ${entryParsed.data.decision_id} is not the next sequence id (expected ${expected}) — reject duplicate or out-of-order ids`,
      ],
    };
  }

  const next: DecisionsLedger = { decisions: [...current.ledger.decisions, entryParsed.data] };
  io.writeFile(file, `${JSON.stringify(next, null, 2)}\n`);
  return { ok: true, ledger: next };
}
