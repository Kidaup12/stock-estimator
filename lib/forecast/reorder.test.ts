import { describe, it, expect } from "vitest";
import { recommendedQty } from "./reorder";

describe("recommendedQty", () => {
  it("subtracts on-order from the gap (FND-04 core)", () => {
    // gap = 100 + 20 - 30 - 50 = 40
    expect(recommendedQty({
      finalForecast30d: 100,
      safetyStock: 20,
      currentStock: 30,
      onOrder: 50,
    })).toBe(40);
  });

  it("ceil-rounds the natural case (10 + 5 - 3 - 0 = 12)", () => {
    expect(recommendedQty({
      finalForecast30d: 10,
      safetyStock: 5,
      currentStock: 3,
      onOrder: 0,
    })).toBe(12);
  });

  it("floors at zero when on-order alone covers demand", () => {
    // 10 + 5 - 3 - 20 = -8 -> 0
    expect(recommendedQty({
      finalForecast30d: 10,
      safetyStock: 5,
      currentStock: 3,
      onOrder: 20,
    })).toBe(0);
  });

  it("floors at zero when currentStock + onOrder exceeds demand + safety", () => {
    expect(recommendedQty({
      finalForecast30d: 50,
      safetyStock: 10,
      currentStock: 40,
      onOrder: 30,
    })).toBe(0);
  });

  it("floors at zero when stock alone exceeds demand", () => {
    expect(recommendedQty({
      finalForecast30d: 10,
      safetyStock: 5,
      currentStock: 200,
      onOrder: 0,
    })).toBe(0);
  });

  it("ceilings fractional quantities up", () => {
    expect(recommendedQty({
      finalForecast30d: 10.1,
      safetyStock: 0,
      currentStock: 0,
      onOrder: 0,
    })).toBe(11);
  });

  it("on-order alone covers demand -> recommends 0", () => {
    expect(recommendedQty({
      finalForecast30d: 50,
      safetyStock: 10,
      currentStock: 0,
      onOrder: 60,
    })).toBe(0);
  });

  it("returns a non-negative integer in natural cases", () => {
    const r = recommendedQty({
      finalForecast30d: 33.4,
      safetyStock: 5.7,
      currentStock: 10,
      onOrder: 2,
    });
    expect(r).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(r)).toBe(true);
  });

  describe("coverDays (category order-cover window)", () => {
    it("defaults to 30 — identical to legacy math when omitted", () => {
      const base = { finalForecast30d: 100, safetyStock: 20, currentStock: 30, onOrder: 50 };
      expect(recommendedQty(base)).toBe(recommendedQty({ ...base, coverDays: 30 }));
    });

    it("LOCAL 17d cover scales demand down (100/30*17=56.7 +20 -30 -0 = 47)", () => {
      expect(recommendedQty({
        finalForecast30d: 100,
        safetyStock: 20,
        currentStock: 30,
        onOrder: 0,
        coverDays: 17,
      })).toBe(47);
    });

    it("import 21d cover (100/30*21=70 +20 -30 -0 = 60)", () => {
      expect(recommendedQty({
        finalForecast30d: 100,
        safetyStock: 20,
        currentStock: 30,
        onOrder: 0,
        coverDays: 21,
      })).toBe(60);
    });

    it("still subtracts on-order under a cover window", () => {
      expect(recommendedQty({
        finalForecast30d: 100,
        safetyStock: 0,
        currentStock: 0,
        onOrder: 60,
        coverDays: 17, // 56.67 - 60 -> 0
      })).toBe(0);
    });
  });
});
