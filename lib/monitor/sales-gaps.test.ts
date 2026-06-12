import { describe, it, expect } from "vitest";
import { findSalesGaps } from "./sales-gaps";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("findSalesGaps", () => {
  it("finds a multi-day hole between the first and last sale", () => {
    // present: 05-01, 05-02, [gap 05-03..05-06], 05-07
    const dates = [d("2026-05-01"), d("2026-05-02"), d("2026-05-07")];
    const r = findSalesGaps(dates);
    expect(r.totalMissingDays).toBe(4); // 03,04,05,06
    expect(r.gaps).toEqual([{ start: "2026-05-03", end: "2026-05-06", days: 4 }]);
  });

  it("reports no gaps for contiguous days", () => {
    const dates = [d("2026-05-01"), d("2026-05-02"), d("2026-05-03")];
    expect(findSalesGaps(dates).gaps).toEqual([]);
  });

  it("ignores single-day gaps below minGapDays (default 2)", () => {
    // missing only 05-02
    const dates = [d("2026-05-01"), d("2026-05-03")];
    const r = findSalesGaps(dates);
    expect(r.totalMissingDays).toBe(1);
    expect(r.gaps).toEqual([]); // below threshold
  });

  it("handles empty input", () => {
    expect(findSalesGaps([])).toEqual({ totalMissingDays: 0, gaps: [] });
  });
});
