/**
 * Pure, deterministic allocator for the next monotonic PM `decision_id`.
 *
 * Given the list of existing decision ids (from the per-epic decisions ledger),
 * returns the next id as `D-<digits>`:
 *   - empty / all-malformed input → `D-001`
 *   - well-formed input → `D-(max + 1)`, zero-padded to width 3 until exceeded,
 *     then natural width
 *
 * Malformed entries (non-`D-<digits>` strings) are silently skipped — the
 * ledger reader rejects bad files up front, but this function stays total so a
 * single bad ledger row never throws here.
 */

const ID_PATTERN = /^D-(\d+)$/;
const MIN_WIDTH = 3;

export function nextDecisionId(existing: readonly string[]): string {
  let max = 0;
  for (const raw of existing) {
    const match = ID_PATTERN.exec(raw);
    if (!match) continue;
    const value = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(value)) continue;
    if (value > max) max = value;
  }
  const next = max + 1;
  const digits = String(next);
  const padded = digits.length >= MIN_WIDTH ? digits : digits.padStart(MIN_WIDTH, "0");
  return `D-${padded}`;
}
