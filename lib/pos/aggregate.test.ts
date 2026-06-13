import { describe, it, expect } from "vitest";
import { aggregatePosSales, type PosSaleIn } from "./aggregate";

const dayKeyOf = (d: Date) => d.toISOString().slice(0, 10); // UTC day for tests
const map = new Map([["111", "pA"], ["222", "pB"]]);

describe("aggregatePosSales", () => {
  it("maps a matched line to its product + day", () => {
    const sales: PosSaleIn[] = [{ date: new Date("2026-06-12T08:00:00Z"), lines: [{ sku: "111", qty: 2, subtotal: 200 }] }];
    const r = aggregatePosSales(sales, map, dayKeyOf);
    expect(r.rows).toEqual([{ productId: "pA", dayKey: "2026-06-12", qty: 2, revenue: 200 }]);
    expect(r.matchedLines).toBe(1);
  });

  it("sums lines for the same product + day", () => {
    const sales: PosSaleIn[] = [
      { date: new Date("2026-06-12T08:00:00Z"), lines: [{ sku: "111", qty: 1, subtotal: 100 }] },
      { date: new Date("2026-06-12T15:00:00Z"), lines: [{ sku: "111", qty: 3, subtotal: 300 }] },
    ];
    const r = aggregatePosSales(sales, map, dayKeyOf);
    expect(r.rows).toEqual([{ productId: "pA", dayKey: "2026-06-12", qty: 4, revenue: 400 }]);
  });

  it("separates different days", () => {
    const sales: PosSaleIn[] = [
      { date: new Date("2026-06-12T08:00:00Z"), lines: [{ sku: "111", qty: 1, subtotal: 100 }] },
      { date: new Date("2026-06-13T08:00:00Z"), lines: [{ sku: "111", qty: 1, subtotal: 100 }] },
    ];
    const r = aggregatePosSales(sales, map, dayKeyOf);
    expect(r.rows.length).toBe(2);
  });

  it("counts + samples unmatched SKUs ('0'/unknown), with no row", () => {
    const sales: PosSaleIn[] = [{ date: new Date("2026-06-12T08:00:00Z"), lines: [
      { sku: "999", qty: 1, subtotal: 50 }, { sku: "0", qty: 1, subtotal: 50 },
    ] }];
    const r = aggregatePosSales(sales, map, dayKeyOf);
    expect(r.rows).toEqual([]);
    expect(r.unmatchedLines).toBe(2);
    expect(r.sampleUnmatchedSkus).toContain("999");
  });

  it("matches SKU case-insensitively + trimmed", () => {
    const m = new Map([["shop-abc", "pX"]]);
    const sales: PosSaleIn[] = [{ date: new Date("2026-06-12T08:00:00Z"), lines: [{ sku: " SHOP-ABC ", qty: 1, subtotal: 10 }] }];
    const r = aggregatePosSales(sales, m, dayKeyOf);
    expect(r.rows[0].productId).toBe("pX");
  });
});
