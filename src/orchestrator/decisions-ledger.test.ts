import { describe, expect, test } from "vitest";

import {
  appendDecision,
  readDecisionsLedger,
  type DecisionsLedgerIo,
} from "./decisions-ledger.js";

/**
 * Pure ledger tests using an injected in-memory IO seam, mirroring
 * `src/install/verify-install.ts`'s InstallReader pattern. No real disk I/O
 * happens here — every file in/out is observed through the seam.
 */
type FsState = Record<string, string>;

function makeIo(initial: FsState = {}): {
  io: DecisionsLedgerIo;
  state: FsState;
  writes: string[];
  reads: string[];
} {
  const state: FsState = { ...initial };
  const writes: string[] = [];
  const reads: string[] = [];

  return {
    state,
    writes,
    reads,
    io: {
      readFileIfExists: (file) => {
        reads.push(file);
        if (!Object.prototype.hasOwnProperty.call(state, file)) return null;
        return state[file] ?? null;
      },
      writeFile: (file, contents) => {
        writes.push(file);
        state[file] = contents;
      },
    },
  };
}

const LEDGER = "/epic/.forge/decisions-ledger.json";

describe("readDecisionsLedger — Zod-validated reader", () => {
  test("missing file yields an empty ledger (ok:true, decisions:[])", () => {
    const { io } = makeIo();
    const result = readDecisionsLedger(LEDGER, io);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.decisions).toEqual([]);
  });

  test("a valid file yields its decisions verbatim", () => {
    const { io } = makeIo({
      [LEDGER]: JSON.stringify({
        decisions: [
          { decision_id: "D-001", ticket: "T01", branch: "forge/x/T01", ts: "2026-05-27T00:00:00Z" },
        ],
      }),
    });

    const result = readDecisionsLedger(LEDGER, io);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.decisions).toHaveLength(1);
    expect(result.ledger.decisions[0]?.decision_id).toBe("D-001");
  });

  test("malformed JSON yields a typed failure (LEDGER_INVALID), not a silent empty", () => {
    const { io } = makeIo({ [LEDGER]: "{ not json" });
    const result = readDecisionsLedger(LEDGER, io);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LEDGER_INVALID");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("a wrong-shape file yields a typed failure (LEDGER_INVALID), not a silent empty", () => {
    const { io } = makeIo({ [LEDGER]: JSON.stringify({ decisions: [{ decision_id: "X-1" }] }) });
    const result = readDecisionsLedger(LEDGER, io);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LEDGER_INVALID");
  });

  test("a file missing the `decisions` array fails (LEDGER_INVALID)", () => {
    const { io } = makeIo({ [LEDGER]: JSON.stringify({}) });
    const result = readDecisionsLedger(LEDGER, io);
    expect(result.ok).toBe(false);
  });

  test("the reader never writes", () => {
    const { io, writes } = makeIo({
      [LEDGER]: JSON.stringify({ decisions: [] }),
    });
    readDecisionsLedger(LEDGER, io);
    expect(writes).toEqual([]);
  });

  test("rejects a ledger with duplicate decision ids (LEDGER_INVALID)", () => {
    const { io } = makeIo({
      [LEDGER]: JSON.stringify({
        decisions: [
          { decision_id: "D-001", ticket: "T01", branch: "forge/x/T01", ts: "2026-05-27T00:00:00Z" },
          { decision_id: "D-001", ticket: "T02", branch: "forge/x/T02", ts: "2026-05-27T00:01:00Z" },
        ],
      }),
    });
    const result = readDecisionsLedger(LEDGER, io);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LEDGER_INVALID");
  });

  test("rejects a ledger whose decision ids decrease in order (LEDGER_INVALID)", () => {
    const { io } = makeIo({
      [LEDGER]: JSON.stringify({
        decisions: [
          { decision_id: "D-002", ticket: "T02", branch: "forge/x/T02", ts: "2026-05-27T00:01:00Z" },
          { decision_id: "D-001", ticket: "T01", branch: "forge/x/T01", ts: "2026-05-27T00:00:00Z" },
        ],
      }),
    });
    const result = readDecisionsLedger(LEDGER, io);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LEDGER_INVALID");
  });

  test("tolerates a gap in decision ids on read (D-001 then D-003 is ok)", () => {
    const { io } = makeIo({
      [LEDGER]: JSON.stringify({
        decisions: [
          { decision_id: "D-001", ticket: "T01", branch: "forge/x/T01", ts: "2026-05-27T00:00:00Z" },
          { decision_id: "D-003", ticket: "T03", branch: "forge/x/T03", ts: "2026-05-27T00:02:00Z" },
        ],
      }),
    });
    const result = readDecisionsLedger(LEDGER, io);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.decisions.map((d) => d.decision_id)).toEqual(["D-001", "D-003"]);
  });
});

describe("appendDecision — single appender behind the IO seam", () => {
  test("appends a new entry to an empty ledger and writes the file", () => {
    const { io, state, writes } = makeIo();
    const entry = { decision_id: "D-001", ticket: "T01", branch: "forge/x/T01", ts: "2026-05-27T00:00:00Z" };
    const result = appendDecision(LEDGER, entry, io);

    expect(result.ok).toBe(true);
    expect(writes).toEqual([LEDGER]);
    const parsed = JSON.parse(state[LEDGER] ?? "") as { decisions: { decision_id: string }[] };
    expect(parsed.decisions).toHaveLength(1);
    expect(parsed.decisions[0]?.decision_id).toBe("D-001");
  });

  test("appends to an existing ledger preserving prior entries in order", () => {
    const { io, state } = makeIo({
      [LEDGER]: JSON.stringify({
        decisions: [{ decision_id: "D-001", ticket: "T01", branch: "forge/x/T01", ts: "2026-05-27T00:00:00Z" }],
      }),
    });

    const result = appendDecision(
      LEDGER,
      { decision_id: "D-002", ticket: "T02", branch: "forge/x/T02", ts: "2026-05-27T00:01:00Z" },
      io,
    );
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(state[LEDGER] ?? "") as { decisions: { decision_id: string }[] };
    expect(parsed.decisions.map((d) => d.decision_id)).toEqual(["D-001", "D-002"]);
  });

  test("rejects an entry whose shape does not validate (no write)", () => {
    const { io, writes } = makeIo();
    // Missing required fields like `branch` and `ts`.
    const bad = { decision_id: "D-001", ticket: "T01" } as unknown as Parameters<typeof appendDecision>[1];
    const result = appendDecision(LEDGER, bad, io);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LEDGER_ENTRY_INVALID");
    expect(writes).toEqual([]);
  });

  test("refuses to clobber a malformed ledger file (LEDGER_INVALID, no write)", () => {
    const { io, writes } = makeIo({ [LEDGER]: "{ not json" });
    const result = appendDecision(
      LEDGER,
      { decision_id: "D-001", ticket: "T01", branch: "forge/x/T01", ts: "2026-05-27T00:00:00Z" },
      io,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LEDGER_INVALID");
    expect(writes).toEqual([]);
  });

  test("rejects a duplicate decision_id with a typed failure and no write", () => {
    const { io, writes } = makeIo({
      [LEDGER]: JSON.stringify({
        decisions: [{ decision_id: "D-001", ticket: "T01", branch: "forge/x/T01", ts: "2026-05-27T00:00:00Z" }],
      }),
    });
    const result = appendDecision(
      LEDGER,
      { decision_id: "D-001", ticket: "T02", branch: "forge/x/T02", ts: "2026-05-27T00:01:00Z" },
      io,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LEDGER_SEQUENCE_INVALID");
    expect(writes).toEqual([]);
  });

  test("rejects a lower-than-next decision_id with a typed failure and no write", () => {
    const { io, writes } = makeIo({
      [LEDGER]: JSON.stringify({
        decisions: [
          { decision_id: "D-001", ticket: "T01", branch: "forge/x/T01", ts: "2026-05-27T00:00:00Z" },
          { decision_id: "D-002", ticket: "T02", branch: "forge/x/T02", ts: "2026-05-27T00:01:00Z" },
        ],
      }),
    });
    // expected next is D-003; D-002 is lower-than-next.
    const result = appendDecision(
      LEDGER,
      { decision_id: "D-002", ticket: "T03", branch: "forge/x/T03", ts: "2026-05-27T00:02:00Z" },
      io,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LEDGER_SEQUENCE_INVALID");
    expect(writes).toEqual([]);
  });

  test("rejects a higher-than-next (gap) decision_id with a typed failure and no write", () => {
    const { io, writes } = makeIo({
      [LEDGER]: JSON.stringify({
        decisions: [{ decision_id: "D-001", ticket: "T01", branch: "forge/x/T01", ts: "2026-05-27T00:00:00Z" }],
      }),
    });
    // expected next is D-002; D-003 skips a value.
    const result = appendDecision(
      LEDGER,
      { decision_id: "D-003", ticket: "T03", branch: "forge/x/T03", ts: "2026-05-27T00:02:00Z" },
      io,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LEDGER_SEQUENCE_INVALID");
    expect(writes).toEqual([]);
  });

  test("accepts an entry equal to nextDecisionId(existing), writes once, preserving order", () => {
    const { io, state, writes } = makeIo({
      [LEDGER]: JSON.stringify({
        decisions: [{ decision_id: "D-001", ticket: "T01", branch: "forge/x/T01", ts: "2026-05-27T00:00:00Z" }],
      }),
    });
    const result = appendDecision(
      LEDGER,
      { decision_id: "D-002", ticket: "T02", branch: "forge/x/T02", ts: "2026-05-27T00:01:00Z" },
      io,
    );
    expect(result.ok).toBe(true);
    expect(writes).toEqual([LEDGER]);
    const parsed = JSON.parse(state[LEDGER] ?? "") as { decisions: { decision_id: string }[] };
    expect(parsed.decisions.map((d) => d.decision_id)).toEqual(["D-001", "D-002"]);
  });

  test("a fresh active ledger accepts D-001 even when an archived sibling also holds D-001 (no cross-file constraint)", () => {
    const ARCHIVED = "/epic/.forge/escalate-attempt1/decisions-ledger.json";
    const { io, state, writes } = makeIo({
      [ARCHIVED]: JSON.stringify({
        decisions: [{ decision_id: "D-001", ticket: "T01", branch: "forge/x/T01", ts: "2026-05-27T00:00:00Z" }],
      }),
    });
    // The active ledger is a distinct (absent) path through the IO seam.
    const result = appendDecision(
      LEDGER,
      { decision_id: "D-001", ticket: "T01", branch: "forge/x/T01", ts: "2026-05-28T00:00:00Z" },
      io,
    );
    expect(result.ok).toBe(true);
    expect(writes).toEqual([LEDGER]);
    const parsed = JSON.parse(state[LEDGER] ?? "") as { decisions: { decision_id: string }[] };
    expect(parsed.decisions.map((d) => d.decision_id)).toEqual(["D-001"]);
  });

  test("nextDecisionId fed by readDecisionsLedger produces D-001 then D-002 across two appends (integration replay)", async () => {
    const { nextDecisionId } = await import("./decision-id.js");
    const { io } = makeIo();

    const first = readDecisionsLedger(LEDGER, io);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const id1 = nextDecisionId(first.ledger.decisions.map((d) => d.decision_id));
    expect(id1).toBe("D-001");
    const ap1 = appendDecision(
      LEDGER,
      { decision_id: id1, ticket: "T01", branch: "forge/x/T01", ts: "2026-05-27T00:00:00Z" },
      io,
    );
    expect(ap1.ok).toBe(true);

    const second = readDecisionsLedger(LEDGER, io);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const id2 = nextDecisionId(second.ledger.decisions.map((d) => d.decision_id));
    expect(id2).toBe("D-002");
  });
});
