import { describe, expect, test } from "vitest";

import {
  acquireLock,
  breakStaleLock,
  LOCK_SCHEMA,
  LockRecordSchema,
  readLock,
  releaseLock,
  serializeLock,
  staleVerdict,
  type LockClock,
  type LockIo,
  type LockRecord,
  type StaleThresholds,
} from "./lock.js";

/**
 * Pure lock tests using an injected in-memory IO seam, mirroring the ledger's
 * `DecisionsLedgerIo` pattern. No real disk I/O, no real `process.kill`, no real
 * clock — the exclusive-create collision, pid liveness, and time all come from
 * the seam, so every behavior is deterministic.
 */
type FsState = Record<string, string>;

function makeIo(initial: FsState = {}): {
  io: LockIo;
  state: FsState;
  creates: string[];
  removes: string[];
} {
  const state: FsState = { ...initial };
  const creates: string[] = [];
  const removes: string[] = [];

  return {
    state,
    creates,
    removes,
    io: {
      createExclusive: (file, contents) => {
        if (Object.prototype.hasOwnProperty.call(state, file)) return { ok: false };
        creates.push(file);
        state[file] = contents;
        return { ok: true };
      },
      readFileIfExists: (file) => {
        if (!Object.prototype.hasOwnProperty.call(state, file)) return null;
        return state[file] ?? null;
      },
      removeFile: (file) => {
        removes.push(file);
        delete state[file];
      },
    },
  };
}

const LOCK = "/epic/.forge/lock.json";

function record(over: Partial<LockRecord> = {}): LockRecord {
  return {
    schema: LOCK_SCHEMA,
    run_id: "run-A",
    session_id: "session-A",
    pid: 1234,
    host: "host-A",
    epic_path: "docs/epics/example",
    ticket: "T01",
    branch: "forge/example/T01",
    repo_root: "/repo",
    acquired_ts: "2026-06-03T00:00:00.000Z",
    heartbeat_ts: "2026-06-03T00:00:00.000Z",
    ...over,
  };
}

const ALIVE: LockClock = {
  now: () => Date.parse("2026-06-03T00:00:00.000Z"),
  currentHost: "host-A",
  isProcessAlive: () => true,
};

const THRESHOLDS: StaleThresholds = {
  heartbeatTtlMs: 60_000,
  acquireTtlMs: 3_600_000,
};

describe("LockRecordSchema — typed forge-lock/v1 record (AC8)", () => {
  test("a complete record validates", () => {
    expect(LockRecordSchema.safeParse(record()).success).toBe(true);
  });

  test("run_id is mandatory", () => {
    const { run_id: _omit, ...withoutRunId } = record();
    expect(LockRecordSchema.safeParse(withoutRunId).success).toBe(false);
  });

  test("run_id must be a non-empty string", () => {
    expect(LockRecordSchema.safeParse(record({ run_id: "" })).success).toBe(false);
  });

  test("the schema is strict — an unknown key is rejected", () => {
    const withExtra = { ...record(), wat: true };
    expect(LockRecordSchema.safeParse(withExtra).success).toBe(false);
  });

  test("the schema literal pins forge-lock/v1", () => {
    const wrongSchema = { ...record(), schema: "forge-lock/v2" };
    expect(LockRecordSchema.safeParse(wrongSchema).success).toBe(false);
  });

  test("includes the identity/diagnostic fields", () => {
    const parsed = LockRecordSchema.parse(record());
    expect(parsed.session_id).toBe("session-A");
    expect(parsed.pid).toBe(1234);
    expect(parsed.host).toBe("host-A");
    expect(parsed.epic_path).toBe("docs/epics/example");
    expect(parsed.ticket).toBe("T01");
    expect(parsed.branch).toBe("forge/example/T01");
    expect(parsed.repo_root).toBe("/repo");
    expect(parsed.acquired_ts).toBe("2026-06-03T00:00:00.000Z");
    expect(parsed.heartbeat_ts).toBe("2026-06-03T00:00:00.000Z");
  });
});

describe("acquireLock — atomic exclusive create", () => {
  test("AC1: acquiring a free lock succeeds and writes a typed record", () => {
    const { io, state, creates } = makeIo();
    const result = acquireLock(LOCK, record(), io);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.run_id).toBe("run-A");
    expect(creates).toEqual([LOCK]);
    const parsed = LockRecordSchema.parse(JSON.parse(state[LOCK] ?? ""));
    expect(parsed.schema).toBe(LOCK_SCHEMA);
  });

  test("AC2: a second acquire while held returns LOCK_HELD with the holder and does not overwrite", () => {
    const held = record({ run_id: "run-A" });
    const { io, state } = makeIo({ [LOCK]: serializeLock(held) });
    const before = state[LOCK];

    const result = acquireLock(LOCK, record({ run_id: "run-B", session_id: "session-B" }), io);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_HELD");
    if (result.code !== "LOCK_HELD") return;
    expect(result.holder.run_id).toBe("run-A");
    // The on-disk lock is byte-for-byte unchanged.
    expect(state[LOCK]).toBe(before);
  });

  test("AC3: acquire relies on exclusive-create collision, not a separate existence check (no overwrite)", () => {
    // The seam only ever creates when absent; a create against an existing key
    // returns { ok: false } without mutating state. Prove the primitive never
    // calls a check-then-write path: it must surface LOCK_HELD and leave the
    // file intact even though the holder differs.
    const held = record({ run_id: "run-A" });
    const { io, state, creates } = makeIo({ [LOCK]: serializeLock(held) });

    const result = acquireLock(LOCK, record({ run_id: "run-B" }), io);

    expect(result.ok).toBe(false);
    // No successful create was recorded — the collision was the gate.
    expect(creates).toEqual([]);
    // Holder untouched.
    const parsed = LockRecordSchema.parse(JSON.parse(state[LOCK] ?? ""));
    expect(parsed.run_id).toBe("run-A");
  });

  test("an ill-shaped proposed record is refused before any write (LOCK_MALFORMED)", () => {
    const { io, creates } = makeIo();
    const bad = { ...record(), run_id: "" };
    const result = acquireLock(LOCK, bad as LockRecord, io);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_MALFORMED");
    expect(creates).toEqual([]);
  });

  test("acquire surfacing a collision over a malformed holder is refused safely (LOCK_MALFORMED, no clobber)", () => {
    const { io, state } = makeIo({ [LOCK]: "{ not json" });
    const before = state[LOCK];
    const result = acquireLock(LOCK, record({ run_id: "run-B" }), io);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_MALFORMED");
    expect(state[LOCK]).toBe(before);
  });
});

describe("acquireLock — idempotent same-owner re-acquire (T01, AC8)", () => {
  test("AC8a: a first acquire by run_id X on a free path succeeds", () => {
    const { io, creates } = makeIo();
    const result = acquireLock(LOCK, record({ run_id: "run-X" }), io);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.run_id).toBe("run-X");
    expect(creates).toEqual([LOCK]);
  });

  test("AC8b: a second acquire by the same run_id X succeeds (idempotent), not LOCK_HELD", () => {
    const { io } = makeIo({ [LOCK]: serializeLock(record({ run_id: "run-X" })) });
    const result = acquireLock(LOCK, record({ run_id: "run-X" }), io);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.run_id).toBe("run-X");
  });

  test("AC8c: the same-owner re-acquire returns the existing on-disk record, not the proposed one", () => {
    // Holder and re-acquire share run_id but differ in diagnostic fields, so a returned
    // holder value proves the existing record was read back (not the proposed one).
    const held = record({
      run_id: "run-X",
      session_id: "session-original",
      pid: 4321,
      heartbeat_ts: "2026-06-03T00:00:00.000Z",
    });
    const { io } = makeIo({ [LOCK]: serializeLock(held) });
    const result = acquireLock(
      LOCK,
      record({ run_id: "run-X", session_id: "session-different", pid: 9999, heartbeat_ts: "2026-06-03T12:00:00.000Z" }),
      io,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.session_id).toBe("session-original");
    expect(result.record.pid).toBe(4321);
    expect(result.record.heartbeat_ts).toBe("2026-06-03T00:00:00.000Z");
  });

  test("AC8d: the idempotent same-owner acquire does not overwrite the on-disk lock and writes nothing", () => {
    const held = record({ run_id: "run-X", session_id: "session-original" });
    const { io, state, creates } = makeIo({ [LOCK]: serializeLock(held) });
    const before = state[LOCK];
    const result = acquireLock(LOCK, record({ run_id: "run-X", session_id: "session-different" }), io);
    expect(result.ok).toBe(true);
    // No new create recorded; the on-disk bytes are unchanged.
    expect(creates).toEqual([]);
    expect(state[LOCK]).toBe(before);
  });

  test("AC8e: a different run_id collision still returns LOCK_HELD with the holder (mutual exclusion preserved)", () => {
    const { io, state } = makeIo({ [LOCK]: serializeLock(record({ run_id: "run-X" })) });
    const before = state[LOCK];
    const result = acquireLock(LOCK, record({ run_id: "run-Y" }), io);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_HELD");
    if (result.code !== "LOCK_HELD") return;
    expect(result.holder.run_id).toBe("run-X");
    expect(state[LOCK]).toBe(before);
  });
});

describe("readLock — inspect", () => {
  test("a missing lock reads as record:null (ok)", () => {
    const { io } = makeIo();
    const result = readLock(LOCK, io);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toBeNull();
  });

  test("AC6: a malformed lock file is refused safely (LOCK_MALFORMED) and never clobbered", () => {
    const { io, state } = makeIo({ [LOCK]: "{ not json" });
    const before = state[LOCK];
    const result = readLock(LOCK, io);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_MALFORMED");
    expect(state[LOCK]).toBe(before);
  });

  test("a structurally-wrong lock file is refused (LOCK_MALFORMED)", () => {
    const { io } = makeIo({ [LOCK]: JSON.stringify({ schema: LOCK_SCHEMA }) });
    const result = readLock(LOCK, io);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_MALFORMED");
  });
});

describe("releaseLock — owner-checked", () => {
  test("AC4: release succeeds only when run_id matches the holder", () => {
    const { io, state, removes } = makeIo({ [LOCK]: serializeLock(record({ run_id: "run-A" })) });
    const result = releaseLock(LOCK, "run-A", io);
    expect(result.ok).toBe(true);
    expect(removes).toEqual([LOCK]);
    expect(Object.prototype.hasOwnProperty.call(state, LOCK)).toBe(false);
  });

  test("AC5: a foreign run_id release is refused (LOCK_FOREIGN) and leaves the lock intact", () => {
    const { io, state, removes } = makeIo({ [LOCK]: serializeLock(record({ run_id: "run-A" })) });
    const before = state[LOCK];
    const result = releaseLock(LOCK, "run-B", io);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_FOREIGN");
    if (result.code !== "LOCK_FOREIGN") return;
    expect(result.holder.run_id).toBe("run-A");
    expect(removes).toEqual([]);
    expect(state[LOCK]).toBe(before);
  });

  test("releasing an absent lock is a typed LOCK_ABSENT", () => {
    const { io, removes } = makeIo();
    const result = releaseLock(LOCK, "run-A", io);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_ABSENT");
    expect(removes).toEqual([]);
  });

  test("releasing over a malformed lock is refused (LOCK_MALFORMED, no remove)", () => {
    const { io, state, removes } = makeIo({ [LOCK]: "{ not json" });
    const before = state[LOCK];
    const result = releaseLock(LOCK, "run-A", io);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_MALFORMED");
    expect(removes).toEqual([]);
    expect(state[LOCK]).toBe(before);
  });
});

describe("staleVerdict — reports, never auto-clears (AC7)", () => {
  test("a fresh, live, same-host lock is never classified stale", () => {
    const { io, state } = makeIo({ [LOCK]: serializeLock(record()) });
    const before = state[LOCK];
    const result = staleVerdict(LOCK, io, ALIVE, THRESHOLDS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdict).not.toBeNull();
    if (result.verdict === null) return;
    expect(result.verdict.stale).toBe(false);
    // Nothing cleared.
    expect(state[LOCK]).toBe(before);
  });

  test("a same-host dead pid yields a stale verdict (dead_pid) but clears nothing", () => {
    const { io, state } = makeIo({ [LOCK]: serializeLock(record()) });
    const before = state[LOCK];
    const clock: LockClock = { ...ALIVE, isProcessAlive: () => false };
    const result = staleVerdict(LOCK, io, clock, THRESHOLDS);
    expect(result.ok).toBe(true);
    if (!result.ok || result.verdict === null) return;
    expect(result.verdict.stale).toBe(true);
    if (!result.verdict.stale) return;
    expect(result.verdict.reasons).toContain("dead_pid");
    expect(state[LOCK]).toBe(before);
  });

  test("an expired heartbeat yields a stale verdict (expired_heartbeat)", () => {
    const { io } = makeIo({
      [LOCK]: serializeLock(record({ heartbeat_ts: "2026-06-02T00:00:00.000Z" })),
    });
    const result = staleVerdict(LOCK, io, ALIVE, THRESHOLDS);
    expect(result.ok).toBe(true);
    if (!result.ok || result.verdict === null) return;
    expect(result.verdict.stale).toBe(true);
    if (!result.verdict.stale) return;
    expect(result.verdict.reasons).toContain("expired_heartbeat");
  });

  test("an exceeded acquire TTL yields a stale verdict (exceeded_acquire_ttl)", () => {
    const { io } = makeIo({
      // Acquired a full day ago; heartbeat still fresh so only the acquire TTL fires.
      [LOCK]: serializeLock(record({ acquired_ts: "2026-06-02T00:00:00.000Z" })),
    });
    const result = staleVerdict(LOCK, io, ALIVE, THRESHOLDS);
    expect(result.ok).toBe(true);
    if (!result.ok || result.verdict === null) return;
    expect(result.verdict.stale).toBe(true);
    if (!result.verdict.stale) return;
    expect(result.verdict.reasons).toContain("exceeded_acquire_ttl");
  });

  test("cross-host: pid liveness is not consulted; a dead pid alone does not make it stale", () => {
    const { io } = makeIo({ [LOCK]: serializeLock(record({ host: "host-B" })) });
    // Caller is host-A; holder is host-B. Even with a dead-pid signal, cross-host
    // pid liveness is unverifiable, so the verdict leans on heartbeat/TTL only.
    const clock: LockClock = { ...ALIVE, isProcessAlive: () => false };
    const result = staleVerdict(LOCK, io, clock, THRESHOLDS);
    expect(result.ok).toBe(true);
    if (!result.ok || result.verdict === null) return;
    expect(result.verdict.stale).toBe(false);
  });

  test("cross-host: an expired heartbeat still makes it stale and is flagged crossHost", () => {
    const { io } = makeIo({
      [LOCK]: serializeLock(record({ host: "host-B", heartbeat_ts: "2026-06-02T00:00:00.000Z" })),
    });
    const clock: LockClock = { ...ALIVE, isProcessAlive: () => false };
    const result = staleVerdict(LOCK, io, clock, THRESHOLDS);
    expect(result.ok).toBe(true);
    if (!result.ok || result.verdict === null) return;
    expect(result.verdict.stale).toBe(true);
    if (!result.verdict.stale) return;
    expect(result.verdict.crossHost).toBe(true);
    expect(result.verdict.reasons).toEqual(["expired_heartbeat"]);
  });

  test("an absent lock yields verdict:null", () => {
    const { io } = makeIo();
    const result = staleVerdict(LOCK, io, ALIVE, THRESHOLDS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdict).toBeNull();
  });

  test("a malformed lock yields LOCK_MALFORMED (never classified, never cleared)", () => {
    const { io, state } = makeIo({ [LOCK]: "{ not json" });
    const before = state[LOCK];
    const result = staleVerdict(LOCK, io, ALIVE, THRESHOLDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_MALFORMED");
    expect(state[LOCK]).toBe(before);
  });
});

describe("breakStaleLock — human-gated, dead-PID-decisive (T01)", () => {
  // Same-host dead pid: the only provable-death signal that authorizes a break.
  const DEAD: LockClock = { ...ALIVE, isProcessAlive: () => false };
  // Confirmation flags that authorize the break for the default holder (run-A).
  const CONFIRMED = { confirmRunId: "run-A", yes: true } as const;

  test("preview (no confirmation flags) reports what would break and clears nothing — even when dead-PID stale", () => {
    const { io, state, removes } = makeIo({ [LOCK]: serializeLock(record()) });
    const before = state[LOCK];

    const result = breakStaleLock(LOCK, io, DEAD, THRESHOLDS, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Preview computes but does not break.
    expect(result.broken).toBe(false);
    if (result.broken) return;
    expect(result.preview.holder.run_id).toBe("run-A");
    expect(result.preview.reasons).toContain("dead_pid");
    expect(result.preview.breakable).toBe(true);
    // Nothing cleared, no remove issued.
    expect(removes).toEqual([]);
    expect(state[LOCK]).toBe(before);
  });

  test("AC8: a same-host dead pid breaks only with --confirm-run-id + --yes and clears the lock", () => {
    const { io, state, removes } = makeIo({ [LOCK]: serializeLock(record()) });

    const result = breakStaleLock(LOCK, io, DEAD, THRESHOLDS, CONFIRMED);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.broken).toBe(true);
    if (!result.broken) return;
    // Lock cleared via removeFile.
    expect(removes).toEqual([LOCK]);
    expect(Object.prototype.hasOwnProperty.call(state, LOCK)).toBe(false);
    // AC14: the audit captures the load-bearing facts.
    expect(result.audit.epic_path).toBe("docs/epics/example");
    expect(result.audit.run_id).toBe("run-A");
    expect(result.audit.pid).toBe(1234);
    expect(result.audit.host).toBe("host-A");
    expect(result.audit.reasons).toContain("dead_pid");
    expect(result.audit.action).toBe("break");
    expect(typeof result.audit.timestamp).toBe("string");
    expect(result.audit.result).toBe("broken");
  });

  test("AC3: --confirm-run-id without --yes refuses and clears nothing (preview / no-mutation)", () => {
    const { io, state, removes } = makeIo({ [LOCK]: serializeLock(record()) });
    const before = state[LOCK];

    const result = breakStaleLock(LOCK, io, DEAD, THRESHOLDS, { confirmRunId: "run-A" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.broken).toBe(false);
    expect(removes).toEqual([]);
    expect(state[LOCK]).toBe(before);
  });

  test("AC4: --yes without --confirm-run-id refuses (no holder echo) and clears nothing", () => {
    const { io, state, removes } = makeIo({ [LOCK]: serializeLock(record()) });
    const before = state[LOCK];

    const result = breakStaleLock(LOCK, io, DEAD, THRESHOLDS, { yes: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_CONFIRM_MISMATCH");
    expect(removes).toEqual([]);
    expect(state[LOCK]).toBe(before);
  });

  test("AC5: a wrong --confirm-run-id (not the on-disk holder) refuses (LOCK_CONFIRM_MISMATCH) and leaves the lock intact", () => {
    const { io, state, removes } = makeIo({ [LOCK]: serializeLock(record({ run_id: "run-A" })) });
    const before = state[LOCK];

    const result = breakStaleLock(LOCK, io, DEAD, THRESHOLDS, { confirmRunId: "run-WRONG", yes: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_CONFIRM_MISMATCH");
    if (result.code !== "LOCK_CONFIRM_MISMATCH") return;
    expect(result.holder.run_id).toBe("run-A");
    expect(removes).toEqual([]);
    expect(state[LOCK]).toBe(before);
  });

  test("AC6: a fresh (live, same-host) lock refuses — even with confirmation — and stays intact (the headline negative)", () => {
    const { io, state, removes } = makeIo({ [LOCK]: serializeLock(record()) });
    const before = state[LOCK];

    const result = breakStaleLock(LOCK, io, ALIVE, THRESHOLDS, CONFIRMED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_NOT_STALE");
    expect(removes).toEqual([]);
    expect(state[LOCK]).toBe(before);
  });

  test("AC6: a fresh lock preview reports not-breakable and clears nothing", () => {
    const { io, state, removes } = makeIo({ [LOCK]: serializeLock(record()) });
    const before = state[LOCK];

    const result = breakStaleLock(LOCK, io, ALIVE, THRESHOLDS, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_NOT_STALE");
    expect(removes).toEqual([]);
    expect(state[LOCK]).toBe(before);
  });

  test("AC7: a live same-host pid refuses even when heartbeat/TTL are aged (no dead_pid → liveness unproven), intact", () => {
    // Heartbeat and acquire are both ancient, but the pid is alive on this host.
    // An aged heartbeat does not prove death; only dead_pid authorizes a break.
    const aged = record({
      heartbeat_ts: "2026-06-02T00:00:00.000Z",
      acquired_ts: "2026-06-02T00:00:00.000Z",
    });
    const { io, state, removes } = makeIo({ [LOCK]: serializeLock(aged) });
    const before = state[LOCK];

    const result = breakStaleLock(LOCK, io, ALIVE, THRESHOLDS, CONFIRMED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_LIVENESS_UNPROVEN");
    expect(removes).toEqual([]);
    expect(state[LOCK]).toBe(before);
  });

  test("AC10: a TTL-only stale lock (acquire TTL exceeded, pid alive) refuses — no dead_pid → not authorized, intact", () => {
    const ttlOnly = record({ acquired_ts: "2026-06-02T00:00:00.000Z" });
    const { io, state, removes } = makeIo({ [LOCK]: serializeLock(ttlOnly) });
    const before = state[LOCK];

    // stale verdict: exceeded_acquire_ttl, but pid alive → no dead_pid.
    const verdict = staleVerdict(LOCK, io, ALIVE, THRESHOLDS);
    expect(verdict.ok).toBe(true);
    if (verdict.ok && verdict.verdict && verdict.verdict.stale) {
      expect(verdict.verdict.reasons).toContain("exceeded_acquire_ttl");
      expect(verdict.verdict.reasons).not.toContain("dead_pid");
    }

    const result = breakStaleLock(LOCK, io, ALIVE, THRESHOLDS, CONFIRMED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_LIVENESS_UNPROVEN");
    expect(removes).toEqual([]);
    expect(state[LOCK]).toBe(before);
  });

  test("AC10: a heartbeat-only stale lock (heartbeat expired, pid alive) refuses — no dead_pid → not authorized, intact", () => {
    const hbOnly = record({ heartbeat_ts: "2026-06-02T00:00:00.000Z" });
    const { io, state, removes } = makeIo({ [LOCK]: serializeLock(hbOnly) });
    const before = state[LOCK];

    const result = breakStaleLock(LOCK, io, ALIVE, THRESHOLDS, CONFIRMED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_LIVENESS_UNPROVEN");
    expect(removes).toEqual([]);
    expect(state[LOCK]).toBe(before);
  });

  test("AC9: a cross-host lock refuses — cross-host pid liveness is unverifiable (no provable death), intact", () => {
    // Holder on host-B, caller host-A. Even with a dead-pid clock, cross-host pid
    // liveness is not consulted, so there is no dead_pid → not breakable.
    const crossHost = record({ host: "host-B" });
    const { io, state, removes } = makeIo({ [LOCK]: serializeLock(crossHost) });
    const before = state[LOCK];

    const result = breakStaleLock(LOCK, io, DEAD, THRESHOLDS, { confirmRunId: "run-A", yes: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A fresh cross-host lock (live by heartbeat/TTL) is simply not stale.
    expect(result.code).toBe("LOCK_NOT_STALE");
    expect(removes).toEqual([]);
    expect(state[LOCK]).toBe(before);
  });

  test("AC9: a cross-host lock that is also heartbeat-stale still refuses (no dead_pid → liveness unproven), intact", () => {
    const crossHostStale = record({ host: "host-B", heartbeat_ts: "2026-06-02T00:00:00.000Z" });
    const { io, state, removes } = makeIo({ [LOCK]: serializeLock(crossHostStale) });
    const before = state[LOCK];

    const result = breakStaleLock(LOCK, io, DEAD, THRESHOLDS, { confirmRunId: "run-A", yes: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_LIVENESS_UNPROVEN");
    expect(removes).toEqual([]);
    expect(state[LOCK]).toBe(before);
  });

  test("AC11: a malformed lock refuses (LOCK_MALFORMED) and is never clobbered", () => {
    const { io, state, removes } = makeIo({ [LOCK]: "{ not json" });
    const before = state[LOCK];

    const result = breakStaleLock(LOCK, io, DEAD, THRESHOLDS, { confirmRunId: "run-A", yes: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_MALFORMED");
    expect(removes).toEqual([]);
    expect(state[LOCK]).toBe(before);
  });

  test("an absent lock refuses (LOCK_ABSENT) and removes nothing", () => {
    const { io, removes } = makeIo();

    const result = breakStaleLock(LOCK, io, DEAD, THRESHOLDS, { confirmRunId: "run-A", yes: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_ABSENT");
    expect(removes).toEqual([]);
  });

  test("AC12: the holder changing between verdict and clear aborts (re-read/CAS) and clears nothing", () => {
    // A clock whose first liveness check is on the dead holder, but a concurrent
    // run replaces the lock with a new holder before the clear. The re-read must
    // detect the run_id change and abort — never removing the new holder's lock.
    const deadHolder = serializeLock(record({ run_id: "run-DEAD" }));
    const newHolder = serializeLock(record({ run_id: "run-NEW", session_id: "session-NEW" }));
    const state: FsState = { [LOCK]: deadHolder };
    const creates: string[] = [];
    const removes: string[] = [];
    let reads = 0;
    const racingIo: LockIo = {
      createExclusive: (file, contents) => {
        if (Object.prototype.hasOwnProperty.call(state, file)) return { ok: false };
        creates.push(file);
        state[file] = contents;
        return { ok: true };
      },
      readFileIfExists: (file) => {
        reads += 1;
        // First read (verdict) sees the dead holder; before the CAS re-read a
        // concurrent run replaces the on-disk lock with a NEW holder. Model that
        // by mutating state at the swap so the file genuinely holds the new owner.
        if (reads >= 2 && file === LOCK) state[file] = newHolder;
        if (!Object.prototype.hasOwnProperty.call(state, file)) return null;
        return state[file] ?? null;
      },
      removeFile: (file) => {
        removes.push(file);
        delete state[file];
      },
    };

    const result = breakStaleLock(LOCK, racingIo, DEAD, THRESHOLDS, {
      confirmRunId: "run-DEAD",
      yes: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_CHANGED");
    // The new holder's lock was never removed.
    expect(removes).toEqual([]);
    expect(state[LOCK]).toBe(newHolder);
  });

  test("AC12: the holder vanishing between verdict and clear aborts (LOCK_CHANGED), removes nothing", () => {
    const deadHolder = serializeLock(record({ run_id: "run-DEAD" }));
    const state: FsState = { [LOCK]: deadHolder };
    const removes: string[] = [];
    let reads = 0;
    const racingIo: LockIo = {
      createExclusive: () => ({ ok: false }),
      readFileIfExists: (file) => {
        reads += 1;
        // The CAS re-read finds the lock gone (a concurrent release in the window).
        if (reads >= 2 && file === LOCK) return null;
        if (!Object.prototype.hasOwnProperty.call(state, file)) return null;
        return state[file] ?? null;
      },
      removeFile: (file) => {
        removes.push(file);
        delete state[file];
      },
    };

    const result = breakStaleLock(LOCK, racingIo, DEAD, THRESHOLDS, {
      confirmRunId: "run-DEAD",
      yes: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("LOCK_CHANGED");
    expect(removes).toEqual([]);
  });
});
