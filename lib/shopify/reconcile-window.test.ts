import { describe, it, expect } from "vitest";
import { computeWindowStart } from "./reconcile-window";

const NOW = new Date("2026-06-05T09:00:00.000Z");

describe("computeWindowStart", () => {
  it("first run (null cursor) looks back the fallback hours, day-aligned", () => {
    const r = computeWindowStart(null, NOW, { overlapHours: 6, firstRunLookbackHours: 48 });
    // 48h before 2026-06-05T09:00 = 2026-06-03T09:00 -> midnight 2026-06-03
    expect(r.toISOString()).toBe("2026-06-03T00:00:00.000Z");
  });

  it("subtracts the overlap then floors to UTC midnight", () => {
    const cursor = new Date("2026-06-05T05:00:00.000Z");
    const r = computeWindowStart(cursor, NOW, { overlapHours: 6, firstRunLookbackHours: 48 });
    // 05:00 - 6h = 2026-06-04T23:00 -> midnight 2026-06-04
    expect(r.toISOString()).toBe("2026-06-04T00:00:00.000Z");
  });

  it("a cursor later in the day still floors to that day's midnight after overlap", () => {
    const cursor = new Date("2026-06-05T08:00:00.000Z");
    const r = computeWindowStart(cursor, NOW, { overlapHours: 6, firstRunLookbackHours: 48 });
    // 08:00 - 6h = 02:00 -> midnight 2026-06-05
    expect(r.toISOString()).toBe("2026-06-05T00:00:00.000Z");
  });
});
