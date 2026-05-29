import { describe, it, expect } from "vitest";
import { mulberry32, seedFrom } from "./rng";

describe("mulberry32", () => {
  it("produces identical sequences for identical seeds", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it("produces identical first 5 values for identical seeds (smoke)", () => {
    const a = mulberry32(987654321);
    const b = mulberry32(987654321);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("returns values in [0, 1)", () => {
    const r = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("seedFrom", () => {
  it("returns the same uint32 for the same input", () => {
    const a = seedFrom(["product-x", 42, "kes"]);
    const b = seedFrom(["product-x", 42, "kes"]);
    expect(a).toBe(b);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(2 ** 32);
  });

  it("drops time-of-day from Date inputs (D-06 invariant)", () => {
    const morning = new Date("2026-05-30T09:00:00Z");
    const evening = new Date("2026-05-30T17:00:00Z");
    expect(seedFrom(["x", morning])).toBe(seedFrom(["x", evening]));
  });

  it("changes seed when productId changes", () => {
    const d = new Date("2026-05-28T00:00:00Z");
    expect(seedFrom(["p1", d])).not.toBe(seedFrom(["p2", d]));
  });

  it("changes seed when the calendar date changes", () => {
    expect(seedFrom(["p1", new Date("2026-05-28T00:00:00Z")]))
      .not.toBe(seedFrom(["p1", new Date("2026-05-29T00:00:00Z")]));
  });
});
