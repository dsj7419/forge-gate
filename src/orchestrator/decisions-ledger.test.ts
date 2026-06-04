import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  appendDecision,
  DecisionsLedgerSchema,
  readDecisionsLedger,
  type DecisionsLedgerIo,
} from "./decisions-ledger.js";
import { defaultDecisionsLedgerIo } from "./ledger-cli.js";

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

/**
 * Deterministic interleaving harness for the atomic / CAS append (Part B).
 *
 * The seam below adds `commitAtomic`, the contention-safe write boundary. It is
 * a compare-and-swap: the commit succeeds only if the file's current bytes
 * still equal the snapshot the caller read (`expectedPrior`). This lets a test
 * drive the exact ordering read-A → read-B → write-A → write-B with no real
 * sleeps or timers — the appends interleave because each reads before the other
 * commits, and the CAS catches the loser.
 */
function makeCasIo(initial: FsState = {}): {
  io: DecisionsLedgerIo;
  state: FsState;
  commits: string[];
} {
  const state: FsState = { ...initial };
  const commits: string[] = [];

  const read = (file: string): string | null => {
    if (!Object.prototype.hasOwnProperty.call(state, file)) return null;
    return state[file] ?? null;
  };

  return {
    state,
    commits,
    io: {
      readFileIfExists: read,
      writeFile: () => {
        throw new Error("the CAS harness must commit through commitAtomic, never the legacy writeFile");
      },
      commitAtomic: (file, contents, expectedPrior) => {
        // CAS: refuse if a concurrent appender changed the file since the read.
        if (read(file) !== expectedPrior) return { ok: false };
        commits.push(file);
        state[file] = contents;
        return { ok: true };
      },
    },
  };
}

const entry = (id: string, ticket: string, ts: string) => ({
  decision_id: id,
  ticket,
  branch: `forge/x/${ticket}`,
  ts,
});

describe("appendDecision — atomic/CAS append under a simulated interleaving harness", () => {
  test("AC13: the harness drives read-A, read-B, write-A, write-B via injected IO ordering (no timers)", () => {
    const { io, state, commits } = makeCasIo();

    // read-A and read-B both observe an absent ledger → both compute D-001.
    const a = appendDecision(LEDGER, entry("D-001", "T01", "2026-06-03T00:00:00Z"), io);
    // After write-A the file holds [D-001].
    expect(a.ok).toBe(true);
    expect(commits).toEqual([LEDGER]);

    // write-B used the SAME absent snapshot (expectedPrior=null), but the file
    // now exists → CAS miss → LEDGER_CONTENTION, no second commit.
    const b = appendDecisionWithSnapshot(io, entry("D-001", "T02", "2026-06-03T00:01:00Z"), null);
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.code).toBe("LEDGER_CONTENTION");
    expect(commits).toEqual([LEDGER]); // still exactly one commit
    const ids = JSON.parse(state[LEDGER] ?? "").decisions.map((d: { decision_id: string }) => d.decision_id);
    expect(ids).toEqual(["D-001"]);
  });

  test("AC9: a concurrent append cannot produce a duplicate decision_id", () => {
    // Seed [D-001]; both A and B read it and both compute next = D-002.
    const seeded = `${JSON.stringify(
      { decisions: [entry("D-001", "T01", "2026-06-03T00:00:00Z")] },
      null,
      2,
    )}\n`;
    const { io, state } = makeCasIo({ [LEDGER]: seeded });

    // Capture B's read snapshot BEFORE A commits.
    const snapshotForB = io.readFileIfExists(LEDGER);

    // write-A commits D-002 against the [D-001] snapshot.
    const a = appendDecision(LEDGER, entry("D-002", "T02", "2026-06-03T00:01:00Z"), io);
    expect(a.ok).toBe(true);

    // write-B tries to commit its own D-002 against the stale [D-001] snapshot.
    const b = appendDecisionWithSnapshot(io, entry("D-002", "T03", "2026-06-03T00:02:00Z"), snapshotForB);
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.code).toBe("LEDGER_CONTENTION");

    const ids = JSON.parse(state[LEDGER] ?? "").decisions.map((d: { decision_id: string }) => d.decision_id);
    // No duplicate D-002 — exactly one survives.
    expect(ids).toEqual(["D-001", "D-002"]);
    expect(ids.filter((x: string) => x === "D-002")).toHaveLength(1);
  });

  test("AC10: a concurrent append cannot lose-update (clobber) another run's decision", () => {
    const { io, state } = makeCasIo();

    // read-A and read-B both see an absent ledger.
    const snapshotForB = io.readFileIfExists(LEDGER); // null

    // write-A commits D-001.
    const a = appendDecision(LEDGER, entry("D-001", "T01", "2026-06-03T00:00:00Z"), io);
    expect(a.ok).toBe(true);

    // write-B would clobber A's [D-001] with its own [D-001] (lost update) — the
    // CAS against the absent snapshot prevents the overwrite.
    const b = appendDecisionWithSnapshot(io, entry("D-001", "T02", "2026-06-03T00:01:00Z"), snapshotForB);
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.code).toBe("LEDGER_CONTENTION");

    // A's decision survives intact; nothing was lost.
    const decisions = JSON.parse(state[LEDGER] ?? "").decisions as { decision_id: string; ticket: string }[];
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision_id).toBe("D-001");
    expect(decisions[0]?.ticket).toBe("T01");
  });

  test("AC11: after a failed-contention case the on-disk ledger still satisfies DecisionsLedgerSchema", () => {
    const seeded = `${JSON.stringify(
      { decisions: [entry("D-001", "T01", "2026-06-03T00:00:00Z")] },
      null,
      2,
    )}\n`;
    const { io, state } = makeCasIo({ [LEDGER]: seeded });
    const snapshotForB = io.readFileIfExists(LEDGER);

    expect(appendDecision(LEDGER, entry("D-002", "T02", "2026-06-03T00:01:00Z"), io).ok).toBe(true);
    const loser = appendDecisionWithSnapshot(io, entry("D-002", "T03", "2026-06-03T00:02:00Z"), snapshotForB);
    expect(loser.ok).toBe(false);

    const onDisk = JSON.parse(state[LEDGER] ?? "");
    const parsed = DecisionsLedgerSchema.safeParse(onDisk);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // Unique + strictly increasing in ledger order.
    expect(parsed.data.decisions.map((d) => d.decision_id)).toEqual(["D-001", "D-002"]);
  });

  test("the winner-then-retry path: B re-reads after losing and appends the correct next id", () => {
    const { io, state } = makeCasIo();
    const snapshotForB = io.readFileIfExists(LEDGER);

    expect(appendDecision(LEDGER, entry("D-001", "T01", "2026-06-03T00:00:00Z"), io).ok).toBe(true);
    expect(appendDecisionWithSnapshot(io, entry("D-001", "T02", "2026-06-03T00:01:00Z"), snapshotForB).ok).toBe(
      false,
    );

    // B retries with a fresh read → sees [D-001] → computes D-002 → commits.
    const retry = appendDecision(LEDGER, entry("D-002", "T02", "2026-06-03T00:02:00Z"), io);
    expect(retry.ok).toBe(true);
    const ids = JSON.parse(state[LEDGER] ?? "").decisions.map((d: { decision_id: string }) => d.decision_id);
    expect(ids).toEqual(["D-001", "D-002"]);
  });

  test("with no contention the CAS path is byte-identical to the legacy single-run write", () => {
    const single = makeIo();
    const cas = makeCasIo();
    const e = entry("D-001", "T01", "2026-06-03T00:00:00Z");

    expect(appendDecision(LEDGER, e, single.io).ok).toBe(true);
    expect(appendDecision(LEDGER, e, cas.io).ok).toBe(true);

    // The serialized on-disk bytes match across the legacy writeFile path and
    // the atomic commitAtomic path — no single-run behavior change.
    expect(cas.state[LEDGER]).toBe(single.state[LEDGER]);
  });

  // Gap 1: directly exercise the PRODUCTION appendDecision LEDGER_CONTENTION
  // branch (decisions-ledger.ts) — NOT the test-local appendDecisionWithSnapshot
  // helper. We inject an IO whose commitAtomic deterministically returns
  // ok:false (a CAS miss, as if a concurrent writer raced in between the read
  // and the commit) and assert the real appender maps that to the typed
  // LEDGER_CONTENTION result with no lost update and no duplicate id on disk.
  test("the REAL appendDecision maps a commitAtomic CAS miss to LEDGER_CONTENTION (no write)", () => {
    // Seed [D-001] so the next sequence id is D-002 and the sequence check
    // passes — the only remaining way to fail is the CAS miss we force below.
    const seeded = `${JSON.stringify(
      { decisions: [entry("D-001", "T01", "2026-06-03T00:00:00Z")] },
      null,
      2,
    )}\n`;
    const state: FsState = { [LEDGER]: seeded };
    const commits: string[] = [];

    const io: DecisionsLedgerIo = {
      readFileIfExists: (file) => {
        if (!Object.prototype.hasOwnProperty.call(state, file)) return null;
        return state[file] ?? null;
      },
      writeFile: () => {
        throw new Error("contention test must not fall back to legacy writeFile");
      },
      // Simulate a concurrent CAS miss: a racing appender changed the file
      // between this caller's read and its commit, so nothing is written.
      commitAtomic: () => ({ ok: false }),
    };

    const result = appendDecision(LEDGER, entry("D-002", "T02", "2026-06-03T00:01:00Z"), io);

    expect(commits).toEqual([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LEDGER_CONTENTION");
    expect(result.errors.length).toBeGreaterThan(0);

    // No lost update, no duplicate id: the on-disk ledger is untouched and
    // still holds exactly the seeded [D-001].
    const onDisk = JSON.parse(state[LEDGER] ?? "") as { decisions: { decision_id: string }[] };
    expect(onDisk.decisions.map((d) => d.decision_id)).toEqual(["D-001"]);
  });
});

/**
 * Commit an append against an explicitly-supplied prior snapshot, modelling a
 * second appender (B) that READ before A committed. Mirrors `appendDecision`'s
 * validate → sequence-check → commit, but uses the captured snapshot as the CAS
 * token so the read-A/read-B/write-A/write-B ordering is exact and deterministic.
 */
function appendDecisionWithSnapshot(
  io: DecisionsLedgerIo,
  e: { decision_id: string; ticket: string; branch: string; ts: string },
  snapshot: string | null,
): { ok: true } | { ok: false; code: string } {
  const priorDecisions = snapshot === null ? [] : (JSON.parse(snapshot).decisions as unknown[]);
  const next = { decisions: [...priorDecisions, e] };
  const contents = `${JSON.stringify(next, null, 2)}\n`;
  const committed = io.commitAtomic?.(LEDGER, contents, snapshot) ?? { ok: false };
  if (!committed.ok) return { ok: false, code: "LEDGER_CONTENTION" };
  return { ok: true };
}

/**
 * Gap 2: real-fs coverage for the PRODUCTION defaultDecisionsLedgerIo.commitAtomic
 * binding (ledger-cli.ts). The CLI tests inject a memory IO with no
 * commitAtomic, so only the legacy fallback runs and the exclusive-temp + atomic
 * rename CAS path is otherwise untested. These tests run the actual fs binding in
 * a unique OS-temp directory (no sleeps, no timers) and prove both CAS outcomes:
 *   (a) a successful commit when the on-disk bytes match the expected snapshot,
 *       leaving the correct final file, and
 *   (b) a CAS miss when the on-disk bytes do NOT match, returning ok:false and
 *       leaving the on-disk file unclobbered.
 */
describe("defaultDecisionsLedgerIo.commitAtomic — real-fs exclusive-temp + atomic rename", () => {
  let tempDir = "";
  let ledgerFile = "";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-ledger-cas-"));
    ledgerFile = path.join(tempDir, ".forge", "decisions-ledger.json");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const ledgerBytes = (ids: string[]): string =>
    `${JSON.stringify(
      { decisions: ids.map((id, i) => entry(id, `T0${i + 1}`, `2026-06-03T0${i}:00:00Z`)) },
      null,
      2,
    )}\n`;

  test("(a) commits when the on-disk bytes match the expected snapshot (absent file → first write)", () => {
    // Snapshot is null: the caller observed no file. The CAS must succeed and
    // the atomic rename must leave the exact bytes on disk.
    const contents = ledgerBytes(["D-001"]);
    const committed = defaultDecisionsLedgerIo.commitAtomic?.(ledgerFile, contents, null);

    expect(committed).toEqual({ ok: true });
    expect(fs.existsSync(ledgerFile)).toBe(true);
    expect(fs.readFileSync(ledgerFile, "utf8")).toBe(contents);
    // No leftover temp files beside the target after the rename.
    const siblings = fs.readdirSync(path.dirname(ledgerFile));
    expect(siblings).toEqual(["decisions-ledger.json"]);
  });

  test("(a) commits when the on-disk bytes match the expected snapshot (existing file → append)", () => {
    const prior = ledgerBytes(["D-001"]);
    fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
    fs.writeFileSync(ledgerFile, prior, "utf8");

    const next = ledgerBytes(["D-001", "D-002"]);
    const committed = defaultDecisionsLedgerIo.commitAtomic?.(ledgerFile, next, prior);

    expect(committed).toEqual({ ok: true });
    expect(fs.readFileSync(ledgerFile, "utf8")).toBe(next);
  });

  test("(b) returns ok:false and does not clobber when the on-disk bytes do NOT match the snapshot", () => {
    // A concurrent writer already left [D-001, D-002] on disk, but our caller's
    // snapshot was the older [D-001]. The CAS must miss and write nothing.
    const onDisk = ledgerBytes(["D-001", "D-002"]);
    fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
    fs.writeFileSync(ledgerFile, onDisk, "utf8");

    const staleSnapshot = ledgerBytes(["D-001"]);
    const wouldClobber = ledgerBytes(["D-001", "D-002-FROM-LOSER"]);
    const committed = defaultDecisionsLedgerIo.commitAtomic?.(ledgerFile, wouldClobber, staleSnapshot);

    expect(committed).toEqual({ ok: false });
    // The on-disk file is untouched — no lost update.
    expect(fs.readFileSync(ledgerFile, "utf8")).toBe(onDisk);
    // And no leftover temp file from the aborted commit.
    const siblings = fs.readdirSync(path.dirname(ledgerFile));
    expect(siblings).toEqual(["decisions-ledger.json"]);
  });

  test("(b) returns ok:false when the snapshot was null but a file already exists on disk", () => {
    // The caller read an absent ledger (snapshot null) but a concurrent writer
    // created the file first → CAS miss, the existing file is preserved.
    const onDisk = ledgerBytes(["D-001"]);
    fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
    fs.writeFileSync(ledgerFile, onDisk, "utf8");

    const committed = defaultDecisionsLedgerIo.commitAtomic?.(ledgerFile, ledgerBytes(["D-001"]), null);

    expect(committed).toEqual({ ok: false });
    expect(fs.readFileSync(ledgerFile, "utf8")).toBe(onDisk);
  });
});
