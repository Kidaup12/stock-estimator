import { describe, it, expect } from "vitest";
import { resolveOpening, daysOfCover, buildPositionView, type PositionInput } from "./position";

describe("resolveOpening", () => {
  it("uses the measured snapshot when one exists at/before the window start", () => {
    const r = resolveOpening({
      snapshotOnHand: 80,
      currentStock: 50,
      soldInWindow: 40,
    });
    expect(r).toEqual({ openingOnHand: 80, openingEstimated: false });
  });

  it("estimates opening = current + sold when no snapshot exists", () => {
    const r = resolveOpening({
      snapshotOnHand: null,
      currentStock: 50,
      soldInWindow: 40,
    });
    expect(r).toEqual({ openingOnHand: 90, openingEstimated: true });
  });
});

describe("daysOfCover", () => {
  it("divides on-hand by the daily run rate", () => {
    expect(daysOfCover(100, 5)).toBe(20);
  });
  it("returns null when run rate is zero (no false infinity)", () => {
    expect(daysOfCover(100, 0)).toBeNull();
  });
});

describe("buildPositionView", () => {
  const base: PositionInput = {
    windowDays: 30,
    rows: [
      { productId: "p1", title: "A-item", sku: "1", abc: "A", currentStock: 60, onOrder: 10,
        expectedArrivalAt: null, leadTimeAvgDays: 30, leadTimeStdDays: 7,
        soldInWindow: 90, snapshotOnHand: 120 },
      { productId: "p2", title: "C-item", sku: "2", abc: null, currentStock: 5, onOrder: 0,
        expectedArrivalAt: null, leadTimeAvgDays: null, leadTimeStdDays: null,
        soldInWindow: 0, snapshotOnHand: null },
    ],
  };

  it("computes run rate as soldInWindow / windowDays", () => {
    const v = buildPositionView(base);
    const a = v.groups.A.rows[0];
    expect(a.runRate).toBeCloseTo(3); // 90 / 30
  });

  it("groups a null abc under C", () => {
    const v = buildPositionView(base);
    expect(v.groups.C.rows.map(r => r.productId)).toContain("p2");
    expect(v.groups.A.rows.map(r => r.productId)).toContain("p1");
  });

  it("produces group subtotals (count, opening, current, enRoute)", () => {
    const v = buildPositionView(base);
    expect(v.groups.A.subtotal).toEqual({
      count: 1, opening: 120, current: 60, enRoute: 10,
    });
  });

  it("flags estimated opening on the C-item with no snapshot", () => {
    const v = buildPositionView(base);
    const c = v.groups.C.rows[0];
    expect(c.openingEstimated).toBe(true);
    expect(c.openingOnHand).toBe(5); // 5 current + 0 sold
  });

  it("days-of-cover is null when the item has no sales (run rate 0)", () => {
    const v = buildPositionView(base);
    expect(v.groups.C.rows[0].daysOfCover).toBeNull();
  });
});
