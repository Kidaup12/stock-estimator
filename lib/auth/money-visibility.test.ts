import { describe, it, expect } from "vitest";
import { canSeeMoney, redactMoney, MONEY_KEYS } from "./money-visibility";

describe("money-visibility", () => {
  it("only OWNER can see money", () => {
    expect(canSeeMoney("OWNER")).toBe(true);
    expect(canSeeMoney("MEMBER")).toBe(false);
    expect(canSeeMoney(undefined)).toBe(false);
    expect(canSeeMoney("")).toBe(false);
  });

  const forecastLike = {
    summary: { revenue30: 1000, cogs30: 400, grossProfit30: 600, grossMarginPct: 0.6, deadStockKes: 50, deadStockRetailKes: 90, activeStockKes: 70, activeStockRetailKes: 120 },
    predictions: [
      { id: "p1", recommendedQty: 5, runRate: 2, product: { costKes: 250, priceKes: 400, currentStock: 8 }, stockValueKes: 2000, reorderCostKes: 1250, reorderRevenueKes: 2000, sales30Revenue: 800 },
    ],
  };

  it("OWNER payload is returned unchanged (same reference)", () => {
    expect(redactMoney(forecastLike, "OWNER")).toBe(forecastLike);
  });

  it("MEMBER: every cost/margin/COGS field is nulled, recursively", () => {
    const r = redactMoney(forecastLike, "MEMBER");
    expect(r.summary.cogs30).toBeNull();
    expect(r.summary.grossProfit30).toBeNull();
    expect(r.summary.grossMarginPct).toBeNull();
    expect(r.summary.deadStockKes).toBeNull();
    expect(r.summary.activeStockKes).toBeNull();
    expect(r.predictions[0].product.costKes).toBeNull();
    expect(r.predictions[0].stockValueKes).toBeNull();
    expect(r.predictions[0].reorderCostKes).toBeNull();
  });

  it("MEMBER: revenue, retail, qty, run rate, stock stay visible", () => {
    const r = redactMoney(forecastLike, "MEMBER");
    expect(r.summary.revenue30).toBe(1000);
    expect(r.summary.deadStockRetailKes).toBe(90);
    expect(r.summary.activeStockRetailKes).toBe(120);
    expect(r.predictions[0].recommendedQty).toBe(5);
    expect(r.predictions[0].runRate).toBe(2);
    expect(r.predictions[0].product.priceKes).toBe(400);
    expect(r.predictions[0].product.currentStock).toBe(8);
    expect(r.predictions[0].reorderRevenueKes).toBe(2000);
  });

  it("MEMBER: no MONEY_KEYS field survives anywhere in the tree", () => {
    const r = redactMoney(forecastLike, "MEMBER") as unknown;
    const offenders: string[] = [];
    const scan = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(scan);
      else if (v && typeof v === "object") {
        for (const [k, val] of Object.entries(v)) {
          if (MONEY_KEYS.has(k) && val !== null) offenders.push(k);
          scan(val);
        }
      }
    };
    scan(r);
    expect(offenders).toEqual([]);
  });
});
