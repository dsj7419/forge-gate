import { describe, expect, test } from "vitest";

import type { CliIo } from "../cli/run.js";
import type { DecisionsLedgerIo } from "./decisions-ledger.js";
import { runLedger } from "./ledger-cli.js";

function fakeIo(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      print: (text) => out.push(text),
      printError: (text) => err.push(text),
      writeArtifact: () => {
        throw new Error("ledger append must never use the validation-artifact seam");
      },
    },
    out,
    err,
  };
}

function memoryLedgerIo(initial: Record<string, string> = {}): {
  ledgerIo: DecisionsLedgerIo;
  state: Record<string, string>;
  writes: { file: string; contents: string }[];
} {
  const state: Record<string, string> = { ...initial };
  const writes: { file: string; contents: string }[] = [];
  const norm = (file: string): string => file.replace(/\\/g, "/");
  return {
    state,
    writes,
    ledgerIo: {
      readFileIfExists: (file) => {
        const key = norm(file);
        return Object.prototype.hasOwnProperty.call(state, key) ? (state[key] ?? null) : null;
      },
      writeFile: (file, contents) => {
        const key = norm(file);
        writes.push({ file: key, contents });
        state[key] = contents;
      },
    },
  };
}

const EPIC = "/epic/example";
const LEDGER = `${EPIC}/.forge/decisions-ledger.json`;

const appendArgs = (
  epic: string,
  over: Partial<{ decisionId: string; ticket: string; branch: string }> = {},
): string[] => [
  "append",
  epic,
  "--decision-id",
  over.decisionId ?? "D-001",
  "--ticket",
  over.ticket ?? "T01",
  "--branch",
  over.branch ?? "forge/x/T01",
];

function ledgerWith(ids: string[]): string {
  return `${JSON.stringify(
    {
      decisions: ids.map((id, i) => ({
        decision_id: id,
        ticket: `T${String(i + 1).padStart(2, "0")}`,
        branch: `forge/x/${id}`,
        ts: `2026-01-0${i + 1}T00:00:00.000Z`,
      })),
    },
    null,
    2,
  )}\n`;
}

describe("runLedger append", () => {
  test("appends D-001 as the first entry against an absent ledger and writes once (exit 0)", () => {
    const { ledgerIo, writes } = memoryLedgerIo();
    const { io, out } = fakeIo();

    const code = runLedger(appendArgs(EPIC), io, ledgerIo);

    expect(code).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.file).toBe(LEDGER);
    const parsed = JSON.parse(out.join("\n")) as { ok: boolean; ledger: { decisions: { decision_id: string }[] } };
    expect(parsed.ok).toBe(true);
    expect(parsed.ledger.decisions).toHaveLength(1);
    expect(parsed.ledger.decisions[0]?.decision_id).toBe("D-001");
  });

  test("generates ts internally as an ISO timestamp (no --ts required)", () => {
    const { ledgerIo, writes } = memoryLedgerIo();
    const { io } = fakeIo();

    const code = runLedger(appendArgs(EPIC), io, ledgerIo);

    expect(code).toBe(0);
    const written = JSON.parse(writes[0]?.contents ?? "") as { decisions: { ts: string }[] };
    const ts = written.decisions[0]?.ts ?? "";
    // ISO 8601 with milliseconds and trailing Z (Date#toISOString shape).
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("appends D-002 onto an existing single-entry ledger (exit 0)", () => {
    const { ledgerIo, writes } = memoryLedgerIo({ [LEDGER]: ledgerWith(["D-001"]) });
    const { io, out } = fakeIo();

    const code = runLedger(appendArgs(EPIC, { decisionId: "D-002", ticket: "T02" }), io, ledgerIo);

    expect(code).toBe(0);
    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(out.join("\n")) as { ledger: { decisions: { decision_id: string }[] } };
    expect(parsed.ledger.decisions.map((d) => d.decision_id)).toEqual(["D-001", "D-002"]);
  });

  test("a duplicate id append fails via C4 LEDGER_SEQUENCE_INVALID and writes nothing (exit 1)", () => {
    const { ledgerIo, writes } = memoryLedgerIo({ [LEDGER]: ledgerWith(["D-001"]) });
    const { io, out } = fakeIo();

    const code = runLedger(appendArgs(EPIC, { decisionId: "D-001" }), io, ledgerIo);

    expect(code).toBe(1);
    expect(writes).toHaveLength(0);
    const parsed = JSON.parse(out.join("\n")) as { ok: boolean; code: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("LEDGER_SEQUENCE_INVALID");
  });

  test("a gap id append fails via C4 LEDGER_SEQUENCE_INVALID and writes nothing (exit 1)", () => {
    const { ledgerIo, writes } = memoryLedgerIo();
    const { io, out } = fakeIo();

    const code = runLedger(appendArgs(EPIC, { decisionId: "D-003" }), io, ledgerIo); // next should be D-001

    expect(code).toBe(1);
    expect(writes).toHaveLength(0);
    expect(JSON.parse(out.join("\n")).code).toBe("LEDGER_SEQUENCE_INVALID");
  });

  test("a malformed existing ledger fails with LEDGER_INVALID and writes nothing (exit 1)", () => {
    const { ledgerIo, writes } = memoryLedgerIo({ [LEDGER]: "{ not json" });
    const { io, out } = fakeIo();

    const code = runLedger(appendArgs(EPIC), io, ledgerIo);

    expect(code).toBe(1);
    expect(writes).toHaveLength(0);
    expect(JSON.parse(out.join("\n")).code).toBe("LEDGER_INVALID");
  });

  test("a malformed --decision-id is rejected with usage (exit 2) before any write", () => {
    const { ledgerIo, writes } = memoryLedgerIo();
    const { io, err } = fakeIo();

    const code = runLedger(appendArgs(EPIC, { decisionId: "X-1" }), io, ledgerIo);

    expect(code).toBe(2);
    expect(writes).toHaveLength(0);
    expect(err.join("\n")).toMatch(/usage|decision-id/i);
  });

  test("requires --decision-id, --ticket, and --branch (exit 2)", () => {
    const { ledgerIo } = memoryLedgerIo();
    const { io } = fakeIo();

    expect(runLedger(["append", EPIC, "--decision-id", "D-001"], io, ledgerIo)).toBe(2);
  });

  test("requires the `append` subcommand (exit 2)", () => {
    const { ledgerIo } = memoryLedgerIo();
    const { io } = fakeIo();

    expect(runLedger([], io, ledgerIo)).toBe(2);
    expect(runLedger(["bogus", EPIC], io, ledgerIo)).toBe(2);
  });

  test("requires <epic> (exit 2)", () => {
    const { ledgerIo } = memoryLedgerIo();
    const { io } = fakeIo();

    expect(runLedger(["append", "--decision-id", "D-001", "--ticket", "T01", "--branch", "b"], io, ledgerIo)).toBe(2);
  });

  test("rejects an unknown flag with usage (exit 2)", () => {
    const { ledgerIo } = memoryLedgerIo();
    const { io } = fakeIo();

    expect(runLedger([...appendArgs(EPIC), "--wat"], io, ledgerIo)).toBe(2);
  });
});
