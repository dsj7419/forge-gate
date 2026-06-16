import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type { CliIo } from "../cli/run.js";
import type { LockClock, LockIo, LockRecord } from "./lock.js";
import { LOCK_SCHEMA, serializeLock } from "./lock.js";
import { defaultLockIo, runLock } from "./lock-cli.js";

/**
 * Deterministic clock for the `break` CLI gates: liveness, host, and time come
 * from the seam, so the dead-PID-decisive behavior is exercised without relying
 * on a real `process.kill` PID being alive/dead at test time.
 */
function memoryClock(over: Partial<LockClock> = {}): LockClock {
  return {
    now: () => Date.parse("2026-06-05T00:00:00.000Z"),
    currentHost: "host-A",
    isProcessAlive: () => true,
    ...over,
  };
}

function fakeIo(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      print: (text) => out.push(text),
      printError: (text) => err.push(text),
      writeArtifact: () => {
        throw new Error("lock cli must never use the validation-artifact seam");
      },
    },
    out,
    err,
  };
}

/**
 * In-memory `LockIo` that honors the exclusive-create contract: a colliding
 * create returns `{ ok: false }` without overwriting the stored contents.
 */
function memoryLockIo(initial: Record<string, string> = {}): {
  lockIo: LockIo;
  state: Record<string, string>;
  creates: { file: string; contents: string }[];
  removes: string[];
} {
  const state: Record<string, string> = { ...initial };
  const creates: { file: string; contents: string }[] = [];
  const removes: string[] = [];
  const norm = (file: string): string => file.replace(/\\/g, "/");
  const has = (file: string): boolean => Object.prototype.hasOwnProperty.call(state, norm(file));
  return {
    state,
    creates,
    removes,
    lockIo: {
      createExclusive: (file, contents) => {
        if (has(file)) return { ok: false };
        state[norm(file)] = contents;
        creates.push({ file: norm(file), contents });
        return { ok: true };
      },
      readFileIfExists: (file) => (has(file) ? (state[norm(file)] ?? null) : null),
      removeFile: (file) => {
        removes.push(norm(file));
        delete state[norm(file)];
      },
    },
  };
}

const EPIC = "/epic/example";
const LOCK = `${EPIC}/.forge/lock.json`;

function holder(over: Partial<LockRecord> = {}): LockRecord {
  return {
    schema: LOCK_SCHEMA,
    run_id: "run-A",
    session_id: "sess-A",
    pid: 4242,
    host: "host-A",
    epic_path: EPIC,
    ticket: "T01",
    branch: "forge/x/T01",
    repo_root: "/repo",
    acquired_ts: "2026-06-05T00:00:00.000Z",
    heartbeat_ts: "2026-06-05T00:00:00.000Z",
    ...over,
  };
}

const acquireArgs = (
  epic: string,
  over: Partial<{ runId: string; sessionId: string; ticket: string; branch: string; repoRoot: string }> = {},
): string[] => [
  "acquire",
  epic,
  "--run-id",
  over.runId ?? "run-A",
  "--session-id",
  over.sessionId ?? "sess-A",
  "--ticket",
  over.ticket ?? "T01",
  "--branch",
  over.branch ?? "forge/x/T01",
  "--repo-root",
  over.repoRoot ?? "/repo",
];

describe("runLock acquire", () => {
  test("acquire-free: writes a forge-lock/v1 record and exits 0", () => {
    const { lockIo, creates, state } = memoryLockIo();
    const { io, out } = fakeIo();

    const code = runLock(acquireArgs(EPIC), io, lockIo);

    expect(code).toBe(0);
    expect(creates).toHaveLength(1);
    expect(creates[0]?.file).toBe(LOCK);
    const parsed = JSON.parse(out.join("\n")) as { ok: boolean; record: LockRecord };
    expect(parsed.ok).toBe(true);
    expect(parsed.record.schema).toBe(LOCK_SCHEMA);
    expect(parsed.record.run_id).toBe("run-A");
    // pid/host/timestamps filled internally.
    expect(typeof parsed.record.pid).toBe("number");
    expect(parsed.record.host.length).toBeGreaterThan(0);
    expect(parsed.record.acquired_ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(parsed.record.heartbeat_ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // The on-disk record round-trips through the strict schema.
    expect(state[LOCK]).toBeDefined();
  });

  test("acquire-held: a second acquire while held exits non-zero with LOCK_HELD and does not overwrite", () => {
    const existing = serializeLock(holder({ run_id: "run-OWNER" }));
    const { lockIo, state } = memoryLockIo({ [LOCK]: existing });
    const { io, out } = fakeIo();

    const code = runLock(acquireArgs(EPIC, { runId: "run-B" }), io, lockIo);

    expect(code).not.toBe(0);
    const parsed = JSON.parse(out.join("\n")) as { ok: boolean; code: string; holder: LockRecord };
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("LOCK_HELD");
    expect(parsed.holder.run_id).toBe("run-OWNER");
    // Existing lock untouched.
    expect(state[LOCK]).toBe(existing);
  });

  test("acquire-malformed: a malformed on-disk lock exits non-zero with LOCK_MALFORMED and is not clobbered", () => {
    const { lockIo, state } = memoryLockIo({ [LOCK]: "{ not json" });
    const { io, out } = fakeIo();

    const code = runLock(acquireArgs(EPIC), io, lockIo);

    expect(code).not.toBe(0);
    const parsed = JSON.parse(out.join("\n")) as { ok: boolean; code: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("LOCK_MALFORMED");
    expect(state[LOCK]).toBe("{ not json");
  });
});

describe("runLock release", () => {
  test("release-owner: a matching run_id clears the lock and exits 0", () => {
    const { lockIo, state, removes } = memoryLockIo({ [LOCK]: serializeLock(holder({ run_id: "run-A" })) });
    const { io, out } = fakeIo();

    const code = runLock(["release", EPIC, "--run-id", "run-A"], io, lockIo);

    expect(code).toBe(0);
    expect(removes).toEqual([LOCK]);
    expect(state[LOCK]).toBeUndefined();
    expect(JSON.parse(out.join("\n")).ok).toBe(true);
  });

  test("release-foreign: a non-matching run_id exits non-zero with LOCK_FOREIGN and leaves the lock intact", () => {
    const existing = serializeLock(holder({ run_id: "run-OWNER" }));
    const { lockIo, state, removes } = memoryLockIo({ [LOCK]: existing });
    const { io, out } = fakeIo();

    const code = runLock(["release", EPIC, "--run-id", "run-B"], io, lockIo);

    expect(code).not.toBe(0);
    expect(removes).toHaveLength(0);
    expect(state[LOCK]).toBe(existing);
    const parsed = JSON.parse(out.join("\n")) as { code: string; holder: LockRecord };
    expect(parsed.code).toBe("LOCK_FOREIGN");
    expect(parsed.holder.run_id).toBe("run-OWNER");
  });

  test("release-absent: no lock exits non-zero with LOCK_ABSENT", () => {
    const { lockIo, removes } = memoryLockIo();
    const { io, out } = fakeIo();

    const code = runLock(["release", EPIC, "--run-id", "run-A"], io, lockIo);

    expect(code).not.toBe(0);
    expect(removes).toHaveLength(0);
    expect(JSON.parse(out.join("\n")).code).toBe("LOCK_ABSENT");
  });

  test("release-malformed: a malformed lock exits non-zero with LOCK_MALFORMED and is never clobbered", () => {
    const { lockIo, state, removes } = memoryLockIo({ [LOCK]: "{ not json" });
    const { io, out } = fakeIo();

    const code = runLock(["release", EPIC, "--run-id", "run-A"], io, lockIo);

    expect(code).not.toBe(0);
    expect(removes).toHaveLength(0);
    expect(state[LOCK]).toBe("{ not json");
    expect(JSON.parse(out.join("\n")).code).toBe("LOCK_MALFORMED");
  });
});

describe("runLock status", () => {
  test("status-fresh: prints the holder and a fresh verdict (exit 0); never clears or steals", () => {
    const now = new Date("2026-06-05T00:00:00.000Z").getTime();
    const existing = serializeLock(
      holder({ acquired_ts: new Date(now).toISOString(), heartbeat_ts: new Date(now).toISOString() }),
    );
    const { lockIo, state, removes } = memoryLockIo({ [LOCK]: existing });
    const { io, out } = fakeIo();

    // A very large TTL guarantees fresh regardless of wall-clock at test time.
    const code = runLock(
      ["status", EPIC, "--heartbeat-ttl-ms", "999999999999", "--acquire-ttl-ms", "999999999999"],
      io,
      lockIo,
    );

    expect(code).toBe(0);
    expect(removes).toHaveLength(0);
    expect(state[LOCK]).toBe(existing);
    const parsed = JSON.parse(out.join("\n")) as { ok: boolean; verdict: { stale: boolean; holder: LockRecord } };
    expect(parsed.ok).toBe(true);
    expect(parsed.verdict.stale).toBe(false);
    expect(parsed.verdict.holder.run_id).toBe("run-A");
  });

  test("status-stale: an expired heartbeat is reported stale with reasons and crossHost (exit 0); never cleared", () => {
    const existing = serializeLock(
      holder({
        host: "some-other-host",
        acquired_ts: "2000-01-01T00:00:00.000Z",
        heartbeat_ts: "2000-01-01T00:00:00.000Z",
      }),
    );
    const { lockIo, state, removes } = memoryLockIo({ [LOCK]: existing });
    const { io, out } = fakeIo();

    const code = runLock(["status", EPIC, "--heartbeat-ttl-ms", "1000", "--acquire-ttl-ms", "1000"], io, lockIo);

    expect(code).toBe(0);
    expect(removes).toHaveLength(0);
    expect(state[LOCK]).toBe(existing);
    const parsed = JSON.parse(out.join("\n")) as {
      ok: boolean;
      verdict: { stale: boolean; reasons: string[]; crossHost: boolean };
    };
    expect(parsed.verdict.stale).toBe(true);
    expect(parsed.verdict.reasons).toContain("expired_heartbeat");
    expect(parsed.verdict.crossHost).toBe(true);
  });

  test("status-absent: no lock reports absent (exit 0) and never clears", () => {
    const { lockIo, removes } = memoryLockIo();
    const { io, out } = fakeIo();

    const code = runLock(["status", EPIC], io, lockIo);

    expect(code).toBe(0);
    expect(removes).toHaveLength(0);
    const parsed = JSON.parse(out.join("\n")) as { ok: boolean; verdict: null };
    expect(parsed.ok).toBe(true);
    expect(parsed.verdict).toBeNull();
  });

  test("status-malformed: a malformed lock exits non-zero with LOCK_MALFORMED and is never clobbered", () => {
    const { lockIo, state, removes } = memoryLockIo({ [LOCK]: "{ not json" });
    const { io, out } = fakeIo();

    const code = runLock(["status", EPIC], io, lockIo);

    expect(code).not.toBe(0);
    expect(removes).toHaveLength(0);
    expect(state[LOCK]).toBe("{ not json");
    expect(JSON.parse(out.join("\n")).code).toBe("LOCK_MALFORMED");
  });

  test("status uses defaulted TTLs when the flags are omitted", () => {
    // A long-ago heartbeat is stale under any sane default TTL.
    const existing = serializeLock(
      holder({ acquired_ts: "2000-01-01T00:00:00.000Z", heartbeat_ts: "2000-01-01T00:00:00.000Z" }),
    );
    const { lockIo } = memoryLockIo({ [LOCK]: existing });
    const { io, out } = fakeIo();

    const code = runLock(["status", EPIC], io, lockIo);

    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n")) as { verdict: { stale: boolean } };
    expect(parsed.verdict.stale).toBe(true);
  });
});

describe("runLock usage errors", () => {
  test("an unknown subcommand exits 2 with usage", () => {
    const { lockIo } = memoryLockIo();
    const { io, err } = fakeIo();

    expect(runLock(["bogus", EPIC], io, lockIo)).toBe(2);
    expect(err.join("\n")).toMatch(/usage/i);
  });

  test("acquire requires <epic>", () => {
    const { lockIo } = memoryLockIo();
    const { io } = fakeIo();
    expect(runLock(["acquire", "--run-id", "run-A"], io, lockIo)).toBe(2);
  });

  test("acquire requires all identity flags", () => {
    const { lockIo } = memoryLockIo();
    const { io } = fakeIo();
    expect(runLock(["acquire", EPIC, "--run-id", "run-A"], io, lockIo)).toBe(2);
  });

  test("acquire rejects an unknown flag", () => {
    const { lockIo } = memoryLockIo();
    const { io } = fakeIo();
    expect(runLock([...acquireArgs(EPIC), "--wat"], io, lockIo)).toBe(2);
  });

  test("acquire rejects a malformed ticket id before any write", () => {
    const { lockIo, creates } = memoryLockIo();
    const { io } = fakeIo();
    expect(runLock(acquireArgs(EPIC, { ticket: "T1" }), io, lockIo)).not.toBe(0);
    expect(creates).toHaveLength(0);
  });

  test("release requires <epic> and --run-id", () => {
    const { lockIo } = memoryLockIo();
    const { io } = fakeIo();
    expect(runLock(["release", EPIC], io, lockIo)).toBe(2);
    expect(runLock(["release", "--run-id", "run-A"], io, lockIo)).toBe(2);
  });

  test("status requires <epic>", () => {
    const { lockIo } = memoryLockIo();
    const { io } = fakeIo();
    expect(runLock(["status"], io, lockIo)).toBe(2);
  });

  test("status rejects an unknown flag", () => {
    const { lockIo } = memoryLockIo();
    const { io } = fakeIo();
    expect(runLock(["status", EPIC, "--wat"], io, lockIo)).toBe(2);
  });
});

describe("runLock break (T01 — human-gated, dead-PID-decisive)", () => {
  // host-A holder; a dead pid on host-A is the only provable-death signal.
  const DEAD = memoryClock({ isProcessAlive: () => false });
  // The break-success path uses a holder whose host matches the clock.
  const breakHolder = (over: Partial<LockRecord> = {}): LockRecord =>
    holder({ host: "host-A", ...over });

  test("break-preview: no confirmation flags reports what would break and does not mutate (dead-PID stale)", () => {
    const existing = serializeLock(breakHolder());
    const { lockIo, state, removes } = memoryLockIo({ [LOCK]: existing });
    const { io, out } = fakeIo();

    const code = runLock(["break", EPIC], io, lockIo, DEAD);

    // Preview is informational, not a break: exit 0, nothing cleared.
    expect(code).toBe(0);
    expect(removes).toHaveLength(0);
    expect(state[LOCK]).toBe(existing);
    const parsed = JSON.parse(out.join("\n")) as {
      ok: boolean;
      broken: boolean;
      preview: { holder: LockRecord; reasons: string[]; breakable: boolean };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.broken).toBe(false);
    expect(parsed.preview.holder.run_id).toBe("run-A");
    expect(parsed.preview.reasons).toContain("dead_pid");
    expect(parsed.preview.breakable).toBe(true);
  });

  test("break-success: a same-host dead pid with --confirm-run-id + --yes clears the lock and prints the audit", () => {
    const existing = serializeLock(breakHolder({ run_id: "run-DEAD", pid: 9090 }));
    const { lockIo, state, removes } = memoryLockIo({ [LOCK]: existing });
    const { io, out } = fakeIo();

    const code = runLock(["break", EPIC, "--confirm-run-id", "run-DEAD", "--yes"], io, lockIo, DEAD);

    expect(code).toBe(0);
    expect(removes).toEqual([LOCK]);
    expect(state[LOCK]).toBeUndefined();
    const parsed = JSON.parse(out.join("\n")) as {
      ok: boolean;
      broken: boolean;
      audit: {
        epic_path: string;
        run_id: string;
        pid: number;
        host: string;
        reasons: string[];
        action: string;
        timestamp: string;
        result: string;
      };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.broken).toBe(true);
    // AC14: minimum printed audit fields.
    expect(parsed.audit.epic_path).toBe(EPIC);
    expect(parsed.audit.run_id).toBe("run-DEAD");
    expect(parsed.audit.pid).toBe(9090);
    expect(parsed.audit.host).toBe("host-A");
    expect(parsed.audit.reasons).toContain("dead_pid");
    expect(parsed.audit.action).toBe("break");
    expect(typeof parsed.audit.timestamp).toBe("string");
    expect(parsed.audit.result).toBe("broken");
  });

  test("break-no-yes: --confirm-run-id without --yes is a preview — clears nothing (AC3)", () => {
    const existing = serializeLock(breakHolder());
    const { lockIo, state, removes } = memoryLockIo({ [LOCK]: existing });
    const { io, out } = fakeIo();

    // Without --yes there is no go-ahead: this is a non-mutating preview (exit 0),
    // regardless of whether --confirm-run-id was supplied. AC3's requirement is
    // that it must not mutate — proven by the intact lock and zero removes.
    const code = runLock(["break", EPIC, "--confirm-run-id", "run-A"], io, lockIo, DEAD);

    expect(code).toBe(0);
    expect(removes).toHaveLength(0);
    expect(state[LOCK]).toBe(existing);
    const parsed = JSON.parse(out.join("\n")) as { ok: boolean; broken: boolean };
    expect(parsed.ok).toBe(true);
    expect(parsed.broken).toBe(false);
  });

  test("break-no-confirm: --yes without --confirm-run-id refuses (LOCK_CONFIRM_MISMATCH, no mutation)", () => {
    const existing = serializeLock(breakHolder());
    const { lockIo, state, removes } = memoryLockIo({ [LOCK]: existing });
    const { io, out } = fakeIo();

    const code = runLock(["break", EPIC, "--yes"], io, lockIo, DEAD);

    expect(code).not.toBe(0);
    expect(removes).toHaveLength(0);
    expect(state[LOCK]).toBe(existing);
    expect(JSON.parse(out.join("\n")).code).toBe("LOCK_CONFIRM_MISMATCH");
  });

  test("break-wrong-confirm: a wrong --confirm-run-id refuses (LOCK_CONFIRM_MISMATCH) and leaves the lock intact", () => {
    const existing = serializeLock(breakHolder({ run_id: "run-DEAD" }));
    const { lockIo, state, removes } = memoryLockIo({ [LOCK]: existing });
    const { io, out } = fakeIo();

    const code = runLock(["break", EPIC, "--confirm-run-id", "run-WRONG", "--yes"], io, lockIo, DEAD);

    expect(code).not.toBe(0);
    expect(removes).toHaveLength(0);
    expect(state[LOCK]).toBe(existing);
    expect(JSON.parse(out.join("\n")).code).toBe("LOCK_CONFIRM_MISMATCH");
  });

  test("break-fresh: a fresh (live same-host) lock refuses (LOCK_NOT_STALE) even with confirmation; intact", () => {
    const existing = serializeLock(breakHolder({ run_id: "run-LIVE" }));
    const { lockIo, state, removes } = memoryLockIo({ [LOCK]: existing });
    const { io, out } = fakeIo();

    // ALIVE clock: process is alive on the same host.
    const code = runLock(
      ["break", EPIC, "--confirm-run-id", "run-LIVE", "--yes"],
      io,
      lockIo,
      memoryClock(),
    );

    expect(code).not.toBe(0);
    expect(removes).toHaveLength(0);
    expect(state[LOCK]).toBe(existing);
    expect(JSON.parse(out.join("\n")).code).toBe("LOCK_NOT_STALE");
  });

  test("break-ttl-only: an aged lock with a live pid refuses (LOCK_LIVENESS_UNPROVEN); intact ( thresholds never authorize a break)", () => {
    const existing = serializeLock(
      breakHolder({
        run_id: "run-AGED",
        acquired_ts: "2000-01-01T00:00:00.000Z",
        heartbeat_ts: "2000-01-01T00:00:00.000Z",
      }),
    );
    const { lockIo, state, removes } = memoryLockIo({ [LOCK]: existing });
    const { io, out } = fakeIo();

    // Tiny TTLs make it stale by heartbeat/acquire, but the pid is alive → no dead_pid.
    const code = runLock(
      [
        "break",
        EPIC,
        "--confirm-run-id",
        "run-AGED",
        "--yes",
        "--heartbeat-ttl-ms",
        "1",
        "--acquire-ttl-ms",
        "1",
      ],
      io,
      lockIo,
      memoryClock(),
    );

    expect(code).not.toBe(0);
    expect(removes).toHaveLength(0);
    expect(state[LOCK]).toBe(existing);
    expect(JSON.parse(out.join("\n")).code).toBe("LOCK_LIVENESS_UNPROVEN");
  });

  test("break-cross-host: a cross-host lock refuses; intact (cross-host pid liveness is unverifiable)", () => {
    const existing = serializeLock(breakHolder({ run_id: "run-REMOTE", host: "host-OTHER" }));
    const { lockIo, state, removes } = memoryLockIo({ [LOCK]: existing });
    const { io } = fakeIo();

    // Even a dead-pid clock cannot prove a cross-host death.
    const code = runLock(
      ["break", EPIC, "--confirm-run-id", "run-REMOTE", "--yes"],
      io,
      lockIo,
      DEAD,
    );

    expect(code).not.toBe(0);
    expect(removes).toHaveLength(0);
    expect(state[LOCK]).toBe(existing);
  });

  test("break-malformed: a malformed lock refuses (LOCK_MALFORMED) and is never clobbered", () => {
    const { lockIo, state, removes } = memoryLockIo({ [LOCK]: "{ not json" });
    const { io, out } = fakeIo();

    const code = runLock(["break", EPIC, "--confirm-run-id", "run-A", "--yes"], io, lockIo, DEAD);

    expect(code).not.toBe(0);
    expect(removes).toHaveLength(0);
    expect(state[LOCK]).toBe("{ not json");
    expect(JSON.parse(out.join("\n")).code).toBe("LOCK_MALFORMED");
  });

  test("break-absent: no lock refuses (LOCK_ABSENT) and removes nothing", () => {
    const { lockIo, removes } = memoryLockIo();
    const { io, out } = fakeIo();

    const code = runLock(["break", EPIC, "--confirm-run-id", "run-A", "--yes"], io, lockIo, DEAD);

    expect(code).not.toBe(0);
    expect(removes).toHaveLength(0);
    expect(JSON.parse(out.join("\n")).code).toBe("LOCK_ABSENT");
  });

  test("break requires <epic>", () => {
    const { lockIo } = memoryLockIo();
    const { io } = fakeIo();
    expect(runLock(["break", "--confirm-run-id", "run-A"], io, lockIo, DEAD)).toBe(2);
  });

  test("break rejects an unknown flag", () => {
    const { lockIo } = memoryLockIo();
    const { io } = fakeIo();
    expect(runLock(["break", EPIC, "--wat"], io, lockIo, DEAD)).toBe(2);
  });
});

describe("defaultLockIo real-fs binding", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  test("createExclusive returns ok then {ok:false} on collision (no overwrite); read and remove work", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-lock-io-"));
    dirs.push(dir);
    // Nested path proves parent-dir creation.
    const file = path.join(dir, ".forge", "lock.json");

    expect(defaultLockIo.readFileIfExists(file)).toBeNull();

    const first = defaultLockIo.createExclusive(file, "first\n");
    expect(first.ok).toBe(true);
    expect(defaultLockIo.readFileIfExists(file)).toBe("first\n");

    const second = defaultLockIo.createExclusive(file, "second\n");
    expect(second.ok).toBe(false);
    // No overwrite: original contents survive the collision.
    expect(defaultLockIo.readFileIfExists(file)).toBe("first\n");

    defaultLockIo.removeFile(file);
    expect(defaultLockIo.readFileIfExists(file)).toBeNull();
    // removeFile on an absent file is a no-op (force: true).
    expect(() => defaultLockIo.removeFile(file)).not.toThrow();
  });
});
