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
 * Result of an atomic compare-and-swap commit. `ok: true` means the new
 * contents were committed because the on-disk file still matched the snapshot
 * the caller read; `ok: false` means a concurrent writer changed the file since
 * that read (contention) and nothing was written.
 */
export type AtomicCommitResult = { ok: true } | { ok: false };

/**
 * The filesystem seam: read the ledger file (or signal absence with `null`) and
 * commit its full contents back. Mirrors `InstallReader`'s single-purpose IO
 * interface so tests run against in-memory state.
 *
 * `commitAtomic` is the contention-safe write boundary. When provided,
 * `appendDecision` commits through it, supplying the exact bytes it read as the
 * compare-and-swap token (`expectedPrior`, `null` when the file was absent at
 * read time). An all-or-nothing implementation (exclusive-create temp + atomic
 * rename, with a re-read CAS check) makes an interleaved second appender lose
 * the race instead of lose-updating or duplicating an id. `commitAtomic` is
 * optional for source-compatibility with existing seams; when it is absent the
 * appender falls back to the legacy `writeFile`, so the single-run path is
 * byte-identical to before.
 */
export type DecisionsLedgerIo = {
  /** Returns the file's UTF-8 contents or `null` if it does not exist. */
  readFileIfExists: (file: string) => string | null;
  /** Writes the file's UTF-8 contents (caller is responsible for atomicity). */
  writeFile: (file: string, contents: string) => void;
  /**
   * Atomically commit `contents` only if the file's current bytes still equal
   * `expectedPrior` (the snapshot the caller read; `null` ⇒ the caller observed
   * no file). Returns `{ ok: false }` on a CAS mismatch (a concurrent writer
   * raced in), writing nothing.
   */
  commitAtomic?: (
    file: string,
    contents: string,
    expectedPrior: string | null,
  ) => AtomicCommitResult;
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
      // LEDGER_CONTENTION is the atomic-commit CAS miss: a concurrent appender
      // changed the file between this caller's read and its commit, so nothing
      // was written (no lost update, no duplicate id).
      code:
        | "LEDGER_INVALID"
        | "LEDGER_ENTRY_INVALID"
        | "LEDGER_SEQUENCE_INVALID"
        | "LEDGER_CONTENTION";
      errors: string[];
    };

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const at = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${at}${issue.message}`;
  });
}

type ReadLedgerWithRaw =
  | { ok: true; ledger: DecisionsLedger; raw: string | null }
  | { ok: false; code: "LEDGER_INVALID"; errors: string[] };

/**
 * Read the ledger and also return the exact bytes observed (`raw`, `null` when
 * the file is absent). The raw snapshot is the compare-and-swap token an atomic
 * commit checks against, so a concurrent write between read and commit is
 * detected.
 */
function readDecisionsLedgerWithRaw(file: string, io: DecisionsLedgerIo): ReadLedgerWithRaw {
  const contents = io.readFileIfExists(file);
  if (contents === null) return { ok: true, ledger: { decisions: [] }, raw: null };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(contents);
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return { ok: false, code: "LEDGER_INVALID", errors: [`malformed JSON: ${message}`] };
  }

  const parsed = DecisionsLedgerSchema.safeParse(parsedJson);
  if (!parsed.success) return { ok: false, code: "LEDGER_INVALID", errors: describeIssues(parsed.error) };
  return { ok: true, ledger: parsed.data, raw: contents };
}

/**
 * Read the ledger file. Missing file → an empty ledger (success). Any other
 * problem (malformed JSON, wrong shape) is a typed `LEDGER_INVALID` failure —
 * never a silent empty, so an upstream bug cannot quietly recycle ids.
 */
export function readDecisionsLedger(file: string, io: DecisionsLedgerIo): ReadLedgerResult {
  const result = readDecisionsLedgerWithRaw(file, io);
  if (!result.ok) return result;
  return { ok: true, ledger: result.ledger };
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

  const current = readDecisionsLedgerWithRaw(file, io);
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
  const contents = `${JSON.stringify(next, null, 2)}\n`;

  // Commit atomically when the seam supports it: the CAS re-checks that the
  // on-disk bytes still equal `current.raw` (the snapshot the expected id was
  // computed against). A racing appender that committed in between fails the
  // CAS, so this caller is rejected with LEDGER_CONTENTION — never a lost update
  // or a duplicate id. When the seam has no `commitAtomic`, fall back to the
  // legacy write so the single-run path is byte-identical.
  if (io.commitAtomic) {
    const committed = io.commitAtomic(file, contents, current.raw);
    if (!committed.ok) {
      return {
        ok: false,
        code: "LEDGER_CONTENTION",
        errors: [
          `concurrent append detected: the ledger changed between read and commit; ${entryParsed.data.decision_id} was not written`,
        ],
      };
    }
    return { ok: true, ledger: next };
  }

  io.writeFile(file, contents);
  return { ok: true, ledger: next };
}
