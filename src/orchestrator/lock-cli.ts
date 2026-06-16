import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { CliIo } from "../cli/run.js";
import {
  acquireLock,
  breakStaleLock,
  releaseLock,
  staleVerdict,
  type BreakOptions,
  type LockClock,
  type LockIo,
  type LockRecord,
  type StaleThresholds,
  LOCK_SCHEMA,
} from "./lock.js";

/**
 * CLI-facing adapter for the Core epic-lock primitive (`src/orchestrator/lock.ts`,
 * shipped in PR #34). It exposes the primitive as a deterministic, fail-closed
 * surface:
 *
 *   forge lock acquire <epic> --run-id <id> --session-id <s> --ticket <t> --branch <b> --repo-root <r>
 *   forge lock release <epic> --run-id <id>
 *   forge lock status  <epic> [--heartbeat-ttl-ms <n>] [--acquire-ttl-ms <n>]
 *
 * The lock file is resolved deterministically at `<epic>/.forge/lock.json` — the
 * same per-epic anchoring as the decisions ledger, with the path caller-supplied
 * (no worktree-aware logic).
 *
 * All filesystem access goes through the injected `LockIo` seam; the command
 * never bypasses it with direct `node:fs` except inside `defaultLockIo`. Tests
 * drive `runLock` through an in-memory `LockIo`; one real-fs temp-dir test
 * proves `defaultLockIo`.
 *
 * Acquire is an atomic exclusive create (`O_EXCL`/`wx`): the create *is* the
 * mutual exclusion, so there is no check-then-write TOCTOU on the lock itself. A
 * collision surfaces as `LOCK_HELD` and the existing lock is never overwritten.
 * (The residual CAS re-check-to-rename window on the *decisions ledger* append
 * remains defense-in-depth; it is airtight only once a later slice wires this
 * lock in to serialize appends. This surface does not wire that — it only makes
 * the lock callable.)
 *
 * `status` is report-only: it computes a fresh/stale verdict and never clears,
 * steals, or force-breaks a lock.
 *
 * `break` is the human-gated stale-recovery surface (T01). It clears an orphaned
 * lock **only** when the holder is provably dead on the same host (`dead_pid`),
 * the operator echoes the holder `run_id` via `--confirm-run-id`, and `--yes` is
 * given; it re-reads (CAS) immediately before clearing. Without `--yes` it is a
 * non-mutating preview. TTL-only / heartbeat-only / cross-host breaks are
 * deferred — an aged heartbeat does not prove death. `break` is human-CLI only;
 * no workflow, orchestrator, or crash handler ever calls it.
 */

function isErrno(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

function readFileIfExists(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (thrown) {
    if (isErrno(thrown) && thrown.code === "ENOENT") return null;
    throw thrown;
  }
}

/**
 * Real-fs `LockIo` binding (mirrors `defaultDecisionsLedgerIo`).
 *
 * `createExclusive` uses the `"wx"` flag (O_EXCL): a colliding file fails with
 * `EEXIST`, which is mapped to `{ ok: false }` rather than overwriting the
 * holder. `removeFile` is `rmSync({ force: true })`, used only on an
 * owner-authorized release. This is the only place real `node:fs` is touched.
 */
export const defaultLockIo: LockIo = {
  createExclusive: (file, contents) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      fs.writeFileSync(file, contents, { encoding: "utf8", flag: "wx" });
      return { ok: true };
    } catch (thrown) {
      if (isErrno(thrown) && thrown.code === "EEXIST") return { ok: false };
      throw thrown;
    }
  },
  readFileIfExists,
  removeFile: (file) => {
    fs.rmSync(file, { force: true });
  },
};

/**
 * Real `LockClock` binding: wall-clock time, the current host, and same-host pid
 * liveness via `process.kill(pid, 0)`. Cross-host liveness is unverifiable, so
 * `staleVerdict`/`breakStaleLock` consult this only when the holder's host
 * matches. Injected into `runLock` (defaulted) so tests drive a deterministic
 * clock without touching real processes.
 */
export const defaultLockClock: LockClock = {
  now: () => Date.now(),
  currentHost: os.hostname(),
  isProcessAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (thrown) {
      // ESRCH → no such process (dead). EPERM → exists but not signalable (alive).
      return isErrno(thrown) && thrown.code === "EPERM";
    }
  },
};

/** Defaulted stale thresholds when the status flags are omitted. */
const DEFAULT_HEARTBEAT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_ACQUIRE_TTL_MS = 60 * 60 * 1000; // 1 hour

const USAGE =
  "usage: forge lock acquire <epic> --run-id <id> --session-id <s> --ticket <t> --branch <b> --repo-root <r>\n" +
  "       forge lock release <epic> --run-id <id>\n" +
  "       forge lock status <epic> [--heartbeat-ttl-ms <n>] [--acquire-ttl-ms <n>]\n" +
  "       forge lock break <epic> [--confirm-run-id <holder-run-id> --yes] [--heartbeat-ttl-ms <n>] [--acquire-ttl-ms <n>]";

const ACQUIRE_FLAGS = new Set(["--run-id", "--session-id", "--ticket", "--branch", "--repo-root"]);
const RELEASE_FLAGS = new Set(["--run-id"]);
const STATUS_FLAGS = new Set(["--heartbeat-ttl-ms", "--acquire-ttl-ms"]);
const BREAK_FLAGS = new Set(["--confirm-run-id", "--yes", "--heartbeat-ttl-ms", "--acquire-ttl-ms"]);

/**
 * `clock` is injected (defaulted to the real binding) so the dead-PID-decisive
 * `break`/`status` behavior is exercised against a deterministic clock in tests.
 * `run.ts` calls this with three args; the optional clock keeps that route
 * unchanged.
 */
export function runLock(
  args: string[],
  cli: CliIo,
  lockIo: LockIo,
  clock: LockClock = defaultLockClock,
): number {
  const subcommand = args[0];
  if (subcommand === "acquire") return runAcquire(args.slice(1), cli, lockIo);
  if (subcommand === "release") return runRelease(args.slice(1), cli, lockIo);
  if (subcommand === "status") return runStatus(args.slice(1), cli, lockIo, clock);
  if (subcommand === "break") return runBreak(args.slice(1), cli, lockIo, clock);
  return usage(cli, `unknown subcommand: ${String(subcommand)}`);
}

function runAcquire(rest: string[], cli: CliIo, lockIo: LockIo): number {
  const epic = rest[0];
  if (epic === undefined || epic.startsWith("--")) return usage(cli, "lock acquire requires <epic>");
  const flags = rest.slice(1);

  const unknown = flags.filter((arg) => arg.startsWith("--") && !ACQUIRE_FLAGS.has(arg));
  if (unknown.length > 0) return usage(cli, `unknown option(s): ${unknown.join(", ")}`);

  const runId = flagValue(flags, "--run-id");
  const sessionId = flagValue(flags, "--session-id");
  const ticket = flagValue(flags, "--ticket");
  const branch = flagValue(flags, "--branch");
  const repoRoot = flagValue(flags, "--repo-root");

  if (
    runId === undefined ||
    sessionId === undefined ||
    ticket === undefined ||
    branch === undefined ||
    repoRoot === undefined
  ) {
    return usage(
      cli,
      "lock acquire requires --run-id, --session-id, --ticket, --branch, --repo-root",
    );
  }

  // pid/host/timestamps are filled internally. The record is re-validated inside
  // acquireLock (LockRecordSchema), so an ill-shaped ticket/branch/etc. is still
  // rejected as LOCK_MALFORMED before any write.
  const nowIso = new Date().toISOString();
  const record: LockRecord = {
    schema: LOCK_SCHEMA,
    run_id: runId,
    session_id: sessionId,
    pid: process.pid,
    host: os.hostname(),
    epic_path: epic,
    // `ticket` is unvalidated here on purpose: acquireLock re-validates the whole
    // record against the strict schema (TicketIdSchema), so a bad id fails closed.
    ticket: ticket as LockRecord["ticket"],
    branch,
    repo_root: repoRoot,
    acquired_ts: nowIso,
    heartbeat_ts: nowIso,
  };

  const file = lockPath(epic);
  const result = acquireLock(file, record, lockIo);
  if (!result.ok) {
    if (result.code === "LOCK_HELD") {
      cli.print(JSON.stringify({ ok: false, code: result.code, holder: result.holder }, null, 2));
    } else {
      cli.print(JSON.stringify({ ok: false, code: result.code, errors: result.errors }, null, 2));
    }
    return 1;
  }
  cli.print(JSON.stringify({ ok: true, record: result.record }, null, 2));
  return 0;
}

function runRelease(rest: string[], cli: CliIo, lockIo: LockIo): number {
  const epic = rest[0];
  if (epic === undefined || epic.startsWith("--")) return usage(cli, "lock release requires <epic>");
  const flags = rest.slice(1);

  const unknown = flags.filter((arg) => arg.startsWith("--") && !RELEASE_FLAGS.has(arg));
  if (unknown.length > 0) return usage(cli, `unknown option(s): ${unknown.join(", ")}`);

  const runId = flagValue(flags, "--run-id");
  if (runId === undefined) return usage(cli, "lock release requires --run-id");

  const file = lockPath(epic);
  const result = releaseLock(file, runId, lockIo);
  if (!result.ok) {
    if (result.code === "LOCK_FOREIGN") {
      cli.print(JSON.stringify({ ok: false, code: result.code, holder: result.holder }, null, 2));
    } else if (result.code === "LOCK_MALFORMED") {
      cli.print(JSON.stringify({ ok: false, code: result.code, errors: result.errors }, null, 2));
    } else {
      cli.print(JSON.stringify({ ok: false, code: result.code }, null, 2));
    }
    return 1;
  }
  cli.print(JSON.stringify({ ok: true }, null, 2));
  return 0;
}

function runStatus(rest: string[], cli: CliIo, lockIo: LockIo, clock: LockClock): number {
  const epic = rest[0];
  if (epic === undefined || epic.startsWith("--")) return usage(cli, "lock status requires <epic>");
  const flags = rest.slice(1);

  const unknown = flags.filter((arg) => arg.startsWith("--") && !STATUS_FLAGS.has(arg));
  if (unknown.length > 0) return usage(cli, `unknown option(s): ${unknown.join(", ")}`);

  const thresholds = parseThresholds(flags);
  if (thresholds === null) {
    return usage(cli, "--heartbeat-ttl-ms and --acquire-ttl-ms must be non-negative integers");
  }

  const file = lockPath(epic);
  // Report only: staleVerdict never clears or steals. We surface the verdict and
  // exit 0 even when stale — recovery is the separate `break` surface.
  const result = staleVerdict(file, lockIo, clock, thresholds);
  if (!result.ok) {
    cli.print(JSON.stringify({ ok: false, code: result.code, errors: result.errors }, null, 2));
    return 1;
  }
  cli.print(JSON.stringify({ ok: true, verdict: result.verdict }, null, 2));
  return 0;
}

/**
 * Human-gated stale-lock recovery (T01). Without `--yes` this is a non-mutating
 * preview. A break proceeds only with both `--confirm-run-id <holder-run-id>`
 * (echoing the on-disk holder) and `--yes`, and only when the holder is provably
 * dead on the same host; `breakStaleLock` re-reads (CAS) before clearing.
 * Thresholds tune only the preview/verdict — they never authorize a break.
 */
function runBreak(rest: string[], cli: CliIo, lockIo: LockIo, clock: LockClock): number {
  const epic = rest[0];
  if (epic === undefined || epic.startsWith("--")) return usage(cli, "lock break requires <epic>");
  const flags = rest.slice(1);

  const unknown = flags.filter((arg) => arg.startsWith("--") && !BREAK_FLAGS.has(arg));
  if (unknown.length > 0) return usage(cli, `unknown option(s): ${unknown.join(", ")}`);

  const thresholds = parseThresholds(flags);
  if (thresholds === null) {
    return usage(cli, "--heartbeat-ttl-ms and --acquire-ttl-ms must be non-negative integers");
  }

  const confirmRunId = flagValue(flags, "--confirm-run-id");
  // Build the options without an explicit `undefined` key: exactOptionalPropertyTypes
  // rejects `confirmRunId: undefined`, and an absent key is the intended "not echoed".
  const options: BreakOptions = {
    yes: flags.includes("--yes"),
    ...(confirmRunId === undefined ? {} : { confirmRunId }),
  };

  const file = lockPath(epic);
  const result = breakStaleLock(file, lockIo, clock, thresholds, options);
  if (!result.ok) {
    if (result.code === "LOCK_MALFORMED") {
      cli.print(JSON.stringify({ ok: false, code: result.code, errors: result.errors }, null, 2));
    } else if (result.code === "LOCK_ABSENT" || result.code === "LOCK_CHANGED") {
      cli.print(JSON.stringify({ ok: false, code: result.code }, null, 2));
    } else if (result.code === "LOCK_LIVENESS_UNPROVEN") {
      cli.print(
        JSON.stringify(
          { ok: false, code: result.code, holder: result.holder, reasons: result.reasons },
          null,
          2,
        ),
      );
    } else {
      cli.print(JSON.stringify({ ok: false, code: result.code, holder: result.holder }, null, 2));
    }
    return 1;
  }
  if (!result.broken) {
    // Preview: informational, no mutation. Exit 0.
    cli.print(JSON.stringify({ ok: true, broken: false, preview: result.preview }, null, 2));
    return 0;
  }
  cli.print(JSON.stringify({ ok: true, broken: true, audit: result.audit }, null, 2));
  return 0;
}

/** Resolve the per-epic lock file (mirrors the ledger's per-epic anchoring). */
function lockPath(epic: string): string {
  return `${epic.replace(/[\\/]+$/, "")}/.forge/lock.json`;
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

/**
 * Parse the shared `--heartbeat-ttl-ms` / `--acquire-ttl-ms` flags into
 * `StaleThresholds`, applying defaults when omitted. Returns `null` on an
 * invalid value (a usage error), so both `status` and `break` reject identically.
 */
function parseThresholds(flags: string[]): StaleThresholds | null {
  const heartbeatTtlMs = numericFlag(flags, "--heartbeat-ttl-ms", DEFAULT_HEARTBEAT_TTL_MS);
  const acquireTtlMs = numericFlag(flags, "--acquire-ttl-ms", DEFAULT_ACQUIRE_TTL_MS);
  if (heartbeatTtlMs === null || acquireTtlMs === null) return null;
  return { heartbeatTtlMs, acquireTtlMs };
}

/**
 * Parse a numeric flag. Returns the default when absent, the parsed value when a
 * valid non-negative integer is supplied, or `null` (a usage error) otherwise.
 */
function numericFlag(args: string[], flag: string, fallback: number): number | null {
  const raw = flagValue(args, flag);
  if (raw === undefined) {
    // The flag may have been supplied without a value (e.g. trailing `--x`).
    return args.includes(flag) ? null : fallback;
  }
  if (!/^\d+$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
}

function usage(cli: CliIo, detail: string): number {
  cli.printError(detail);
  cli.printError(USAGE);
  return 2;
}
