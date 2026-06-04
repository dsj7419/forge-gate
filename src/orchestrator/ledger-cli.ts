import * as fs from "node:fs";
import * as path from "node:path";

import type { CliIo } from "../cli/run.js";
import {
  appendDecision,
  type DecisionsLedgerIo,
  type LedgerEntry,
} from "./decisions-ledger.js";

/**
 * CLI-facing adapter for the per-epic decisions ledger.
 *
 * `forge ledger append <epic> --decision-id <D-NNN> --ticket <ticket> --branch <branch>`
 * builds a `LedgerEntry` (generating `ts` internally as an ISO timestamp) and
 * records it through the existing Core appender (`appendDecision`) against
 * `<epic>/.forge/decisions-ledger.json`. This puts C4's `LEDGER_SEQUENCE_INVALID`
 * guard on the live path and removes the previously hand-authored ledger append.
 *
 * All filesystem access goes through the injected `DecisionsLedgerIo` seam; the
 * command never bypasses it with direct `node:fs`. The default real-fs impl is
 * `defaultDecisionsLedgerIo` (mirrors `defaultRunReportIo`).
 */

function readFileIfExists(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (thrown) {
    if (isErrno(thrown) && thrown.code === "ENOENT") return null;
    throw thrown;
  }
}

export const defaultDecisionsLedgerIo: DecisionsLedgerIo = {
  readFileIfExists,
  writeFile: (file, contents) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, "utf8");
  },
  // Atomic compare-and-swap commit: write to an exclusive-create temp file,
  // re-check that the target's current bytes still equal `expectedPrior` (the
  // snapshot the caller read), and only then atomically rename the temp over
  // the target. A racing appender that committed in between changes the bytes,
  // so the CAS re-check fails and we abort without clobbering. The exclusive
  // ("wx") temp create plus the all-or-nothing rename make the write boundary
  // atomic against an interleaved second appender.
  commitAtomic: (file, contents, expectedPrior) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });

    // Pre-check the CAS token before doing any work.
    if (readFileIfExists(file) !== expectedPrior) return { ok: false };

    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    // Exclusive create: a colliding temp name from another in-flight commit
    // fails here rather than overwriting it.
    fs.writeFileSync(temp, contents, { encoding: "utf8", flag: "wx" });
    try {
      // Re-check the CAS token immediately before the rename — the smallest
      // window we can achieve without an OS file lock. A concurrent committer
      // that won the race between the pre-check and here is caught here.
      if (readFileIfExists(file) !== expectedPrior) {
        fs.rmSync(temp, { force: true });
        return { ok: false };
      }
      fs.renameSync(temp, file);
      return { ok: true };
    } catch (thrown) {
      fs.rmSync(temp, { force: true });
      throw thrown;
    }
  },
};

const USAGE =
  "usage: forge ledger append <epic> --decision-id <D-NNN> --ticket <ticket> --branch <branch>";

const KNOWN_FLAGS = new Set(["--decision-id", "--ticket", "--branch"]);
const DECISION_ID_PATTERN = /^D-\d+$/;

export function runLedger(args: string[], cli: CliIo, io: DecisionsLedgerIo): number {
  const subcommand = args[0];
  if (subcommand !== "append") return usage(cli, `unknown subcommand: ${String(subcommand)}`);

  const epic = args[1];
  if (epic === undefined || epic.startsWith("--")) {
    return usage(cli, "ledger append requires <epic>");
  }
  const rest = args.slice(2);

  const unknown = rest.filter((arg) => arg.startsWith("--") && !KNOWN_FLAGS.has(arg));
  if (unknown.length > 0) return usage(cli, `unknown option(s): ${unknown.join(", ")}`);

  const decisionId = flagValue(rest, "--decision-id");
  const ticket = flagValue(rest, "--ticket");
  const branch = flagValue(rest, "--branch");

  if (decisionId === undefined || ticket === undefined || branch === undefined) {
    return usage(cli, "ledger append requires --decision-id, --ticket, --branch");
  }
  if (!DECISION_ID_PATTERN.test(decisionId)) {
    return usage(cli, `--decision-id must match D-<digits>; got ${JSON.stringify(decisionId)}`);
  }

  // `ts` is generated internally — there is no required --ts. The entry shape is
  // re-validated inside appendDecision (LedgerEntrySchema), so an ill-shaped
  // ticket/branch is still rejected before any write.
  const file = ledgerPath(epic);
  const entry: LedgerEntry = {
    decision_id: decisionId,
    ticket,
    branch,
    ts: new Date().toISOString(),
  };

  const result = appendDecision(file, entry, io);
  if (!result.ok) {
    cli.print(JSON.stringify({ ok: false, code: result.code, errors: result.errors }, null, 2));
    return 1;
  }
  cli.print(JSON.stringify({ ok: true, ledger: result.ledger }, null, 2));
  return 0;
}

function ledgerPath(epic: string): string {
  return `${epic.replace(/[\\/]+$/, "")}/.forge/decisions-ledger.json`;
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

function usage(cli: CliIo, detail: string): number {
  cli.printError(detail);
  cli.printError(USAGE);
  return 2;
}

function isErrno(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
