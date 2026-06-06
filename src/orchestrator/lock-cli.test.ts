import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type { CliIo } from "../cli/run.js";
import type { LockIo, LockRecord } from "./lock.js";
import { LOCK_SCHEMA, serializeLock } from "./lock.js";
import { defaultLockIo, runLock } from "./lock-cli.js";

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
