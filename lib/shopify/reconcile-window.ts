/**
 * Compute the day-aligned start of a reconcile window.
 *
 * - First run (no cursor): look back `firstRunLookbackHours` (the backfill already
 *   loaded 365d, so 48h is plenty of overlap).
 * - Subsequent runs: start at the stored cursor minus `overlapHours` of safety
 *   (catches late-arriving / edited records), floored to UTC midnight so whole
 *   days are re-pulled — required for the idempotent day-set sales writer.
 */
export function computeWindowStart(
  cursor: Date | null,
  now: Date,
  opts: { overlapHours: number; firstRunLookbackHours: number }
): Date {
  const base = cursor
    ? new Date(cursor.getTime() - opts.overlapHours * 3600_000)
    : new Date(now.getTime() - opts.firstRunLookbackHours * 3600_000);
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
}
