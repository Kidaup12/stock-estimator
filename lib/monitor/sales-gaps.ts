/**
 * "May-hole" detector (Dave DoD §8): finds stretches of days with NO sales rows
 * between the first and last sale — i.e. days where sales data went missing (a
 * broken sync leaves a hole that silently deflates the run rate). Pure module.
 */

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export type SalesGap = { start: string; end: string; days: number };

/**
 * @param dates  all sales-history dates for a tenant (any order, dups ok)
 * @param minGapDays  only report runs of this many consecutive missing days (default 2)
 */
export function findSalesGaps(dates: Date[], minGapDays = 2): { totalMissingDays: number; gaps: SalesGap[] } {
  if (dates.length === 0) return { totalMissingDays: 0, gaps: [] };
  const present = new Set(dates.map(dayKey));
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const first = new Date(`${dayKey(sorted[0])}T00:00:00.000Z`);
  const last = new Date(`${dayKey(sorted[sorted.length - 1])}T00:00:00.000Z`);

  const gaps: SalesGap[] = [];
  let totalMissingDays = 0;
  let runStart: string | null = null;
  let runDays = 0;

  for (let d = new Date(first); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = dayKey(d);
    if (present.has(k)) {
      if (runStart && runDays >= minGapDays) {
        const end = new Date(`${k}T00:00:00.000Z`);
        end.setUTCDate(end.getUTCDate() - 1);
        gaps.push({ start: runStart, end: dayKey(end), days: runDays });
      }
      runStart = null;
      runDays = 0;
    } else {
      if (!runStart) runStart = k;
      runDays++;
      totalMissingDays++;
    }
  }
  // (No trailing run: the loop ends on `last`, which is present by construction.)
  return { totalMissingDays, gaps };
}
