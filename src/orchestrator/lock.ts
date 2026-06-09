import { z } from "zod";

import { NonEmptyStringSchema, TicketIdSchema } from "../schema/enums.js";

/**
 * Core epic-level lock primitive (`forge-lock/v1`).
 *
 * A run claims exclusive ownership of an epic by atomically creating the lock
 * file at a caller-supplied path (canonically `$EPIC/.forge/lock.json`). The
 * create *is* the mutual exclusion: there is no separate existence check, so
 * there is no check-then-write TOCTOU. A collision surfaces as a typed
 * `LOCK_HELD` result carrying the current holder, and the existing lock is
 * never overwritten.
 *
 * Like the decisions ledger, the primitive is pure and seam-injected: all
 * filesystem and environment access goes through `LockIo`, so every behavior is
 * unit-tested against in-memory state. The real `fs` binding (exclusive create
 * via `O_EXCL`/`wx`, atomic rename) and any CLI exposure are a deferred wiring
 * slice — this module delivers the primitive and its tests only.
 *
 * Anchoring (ratified PM decision): the lock path is *caller-supplied*. The
 * primitive invents no worktree-aware path logic. Worktree isolation remains
 * unsafe for shared decision provenance until a stable, non-worktree-fragmented
 * shared-state location exists.
 */

/** The only lock schema version this build understands. */
export const LOCK_SCHEMA = "forge-lock/v1" as const;

/**
 * The typed lock record. `run_id` is mandatory and is the ownership key (used
 * for release authorization, diagnostics, and future evidence ownership). The
 * remaining fields are identity/diagnostic. The schema is strict so an unknown
 * key on disk is rejected rather than silently carried.
 */
export const LockRecordSchema = z
  .object({
    schema: z.literal(LOCK_SCHEMA),
    run_id: NonEmptyStringSchema,
    session_id: NonEmptyStringSchema,
    pid: z.number().int(),
    host: NonEmptyStringSchema,
    epic_path: NonEmptyStringSchema,
    ticket: TicketIdSchema,
    branch: NonEmptyStringSchema,
    repo_root: NonEmptyStringSchema,
    acquired_ts: NonEmptyStringSchema,
    heartbeat_ts: NonEmptyStringSchema,
  })
  .strict();

export type LockRecord = z.infer<typeof LockRecordSchema>;

/**
 * Single-purpose IO seam, mirroring `DecisionsLedgerIo`. Tests inject an
 * in-memory implementation; the deferred real binding maps `createExclusive`
 * onto `fs.open(file, "wx")` (O_EXCL) and `removeFile` onto `fs.rmSync`.
 */
export type LockIo = {
  /**
   * Atomically create the file with the given contents, failing if it already
   * exists. The collision (not a separate existence check) is the mutual
   * exclusion. Returns `{ ok: true }` on create, or `{ ok: false }` when the
   * target already existed (the real binding maps `EEXIST` to this).
   */
  createExclusive: (file: string, contents: string) => { ok: true } | { ok: false };
  /** Returns the file's UTF-8 contents or `null` if it does not exist. */
  readFileIfExists: (file: string) => string | null;
  /** Removes the file. Used only on owner-authorized release. */
  removeFile: (file: string) => void;
};

/**
 * Liveness/time inputs for stale detection, injected so verdicts are
 * deterministic in tests (no real `Date.now`, no real `process.kill`).
 */
export type LockClock = {
  /** Current time as epoch milliseconds. */
  now: () => number;
  /** This caller's host identity, compared to the holder's `host`. */
  currentHost: string;
  /**
   * Whether `pid` is alive *on the same host*. Cross-host liveness is
   * unverifiable, so this is consulted only when the holder's host matches
   * `currentHost`.
   */
  isProcessAlive: (pid: number) => boolean;
};

/** Thresholds for the stale verdict, in milliseconds. */
export type StaleThresholds = {
  /** Max age of `heartbeat_ts` before the lock is considered stale. */
  heartbeatTtlMs: number;
  /** Max age of `acquired_ts` (whole-run TTL) before the lock is considered stale. */
  acquireTtlMs: number;
};

export type AcquireResult =
  | { ok: true; record: LockRecord }
  | { ok: false; code: "LOCK_HELD"; holder: LockRecord }
  | { ok: false; code: "LOCK_MALFORMED"; errors: string[] };

export type ReadLockResult =
  | { ok: true; record: LockRecord }
  | { ok: true; record: null }
  | { ok: false; code: "LOCK_MALFORMED"; errors: string[] };

export type ReleaseResult =
  | { ok: true }
  | { ok: false; code: "LOCK_ABSENT" }
  | { ok: false; code: "LOCK_FOREIGN"; holder: LockRecord }
  | { ok: false; code: "LOCK_MALFORMED"; errors: string[] };

export type StaleReason = "dead_pid" | "expired_heartbeat" | "exceeded_acquire_ttl";

export type StaleVerdict =
  | { stale: false; holder: LockRecord }
  | { stale: true; holder: LockRecord; reasons: StaleReason[]; crossHost: boolean };

export type StaleVerdictResult =
  | { ok: true; verdict: StaleVerdict }
  | { ok: true; verdict: null } // no lock present
  | { ok: false; code: "LOCK_MALFORMED"; errors: string[] };

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const at = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${at}${issue.message}`;
  });
}

function parseRecord(contents: string): { ok: true; record: LockRecord } | { ok: false; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(contents);
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return { ok: false, errors: [`malformed JSON: ${message}`] };
  }
  const parsed = LockRecordSchema.safeParse(json);
  if (!parsed.success) return { ok: false, errors: describeIssues(parsed.error) };
  return { ok: true, record: parsed.data };
}

/** Serialize a lock record to the canonical on-disk form (validated first). */
export function serializeLock(record: LockRecord): string {
  // Re-validate so a hand-built record can never write an off-schema file.
  const parsed = LockRecordSchema.parse(record);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/**
 * Read and parse the on-disk lock. Missing file → `{ ok: true, record: null }`.
 * A malformed/unparseable file is refused with a typed error and is never
 * clobbered here.
 */
export function readLock(file: string, io: LockIo): ReadLockResult {
  const contents = io.readFileIfExists(file);
  if (contents === null) return { ok: true, record: null };
  const parsed = parseRecord(contents);
  if (!parsed.ok) return { ok: false, code: "LOCK_MALFORMED", errors: parsed.errors };
  return { ok: true, record: parsed.record };
}

/**
 * Acquire the lock via atomic exclusive create. On a free path the typed record
 * is written and returned. On collision the existing holder is read back and
 * returned as `LOCK_HELD` — the existing lock is never overwritten. The record
 * is validated before any write so an ill-shaped record cannot be persisted.
 */
export function acquireLock(file: string, record: LockRecord, io: LockIo): AcquireResult {
  // Validate the proposed record up front: never write an off-schema lock.
  const proposed = LockRecordSchema.safeParse(record);
  if (!proposed.success) {
    return { ok: false, code: "LOCK_MALFORMED", errors: describeIssues(proposed.error) };
  }

  const created = io.createExclusive(file, serializeLock(proposed.data));
  if (created.ok) return { ok: true, record: proposed.data };

  // Collision: the create itself was the mutual exclusion. Read the current
  // holder to report it. We never overwrite the existing lock.
  const existing = readLock(file, io);
  if (!existing.ok) return { ok: false, code: "LOCK_MALFORMED", errors: existing.errors };
  if (existing.record === null) {
    // The exclusive create reported a collision but the file is now gone — a
    // foreign concurrent release. Treat as held-by-unknown rather than silently
    // overwriting; fail closed.
    return {
      ok: false,
      code: "LOCK_MALFORMED",
      errors: ["exclusive create reported a collision but no lock file is present"],
    };
  }
  // Idempotent same-owner re-acquire: a run UUID is unique to one run, so an
  // on-disk holder with the requested `run_id` is provably this same run already
  // owning the lock (e.g. a subagent that executed the acquire twice in one
  // dispatch). Return the existing record as-is — no second write, the on-disk
  // content is unchanged. Mutual exclusion is preserved: a *different* run_id is
  // still a foreign holder below.
  if (existing.record.run_id === proposed.data.run_id) {
    return { ok: true, record: existing.record };
  }
  return { ok: false, code: "LOCK_HELD", holder: existing.record };
}

/**
 * Release the lock. Succeeds only when the caller's `run_id` matches the
 * on-disk holder's `run_id`. A foreign `run_id` is refused and the lock file is
 * left intact. A malformed lock is refused (never clobbered). A missing lock is
 * a typed `LOCK_ABSENT`.
 */
export function releaseLock(file: string, runId: string, io: LockIo): ReleaseResult {
  const existing = readLock(file, io);
  if (!existing.ok) return { ok: false, code: "LOCK_MALFORMED", errors: existing.errors };
  if (existing.record === null) return { ok: false, code: "LOCK_ABSENT" };
  if (existing.record.run_id !== runId) {
    return { ok: false, code: "LOCK_FOREIGN", holder: existing.record };
  }
  io.removeFile(file);
  return { ok: true };
}

function ageMs(now: number, isoTs: string): number | null {
  const t = Date.parse(isoTs);
  if (!Number.isFinite(t)) return null;
  return now - t;
}

/**
 * Compute a stale verdict for the lock without ever clearing or stealing it.
 * A lock is stale when any holder-liveness signal fails:
 *   - same-host dead `pid`
 *   - `heartbeat_ts` older than `heartbeatTtlMs`
 *   - `acquired_ts` older than `acquireTtlMs`
 * Cross-host: `pid` liveness is unverifiable, so the verdict leans on
 * heartbeat/TTL only (the dead-pid signal is not consulted). The primitive
 * reports; it never auto-clears.
 */
export function staleVerdict(
  file: string,
  io: LockIo,
  clock: LockClock,
  thresholds: StaleThresholds,
): StaleVerdictResult {
  const existing = readLock(file, io);
  if (!existing.ok) return { ok: false, code: "LOCK_MALFORMED", errors: existing.errors };
  if (existing.record === null) return { ok: true, verdict: null };

  const holder = existing.record;
  const now = clock.now();
  const reasons: StaleReason[] = [];
  const crossHost = holder.host !== clock.currentHost;

  // Same-host dead pid. Cross-host pid liveness is unverifiable → not consulted.
  if (!crossHost && !clock.isProcessAlive(holder.pid)) {
    reasons.push("dead_pid");
  }

  const heartbeatAge = ageMs(now, holder.heartbeat_ts);
  if (heartbeatAge !== null && heartbeatAge > thresholds.heartbeatTtlMs) {
    reasons.push("expired_heartbeat");
  }

  const acquireAge = ageMs(now, holder.acquired_ts);
  if (acquireAge !== null && acquireAge > thresholds.acquireTtlMs) {
    reasons.push("exceeded_acquire_ttl");
  }

  if (reasons.length === 0) return { ok: true, verdict: { stale: false, holder } };
  return { ok: true, verdict: { stale: true, holder, reasons, crossHost } };
}
