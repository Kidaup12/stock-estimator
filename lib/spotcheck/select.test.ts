import { describe, it, expect } from "vitest";
import { selectSpotChecks } from "./select";

const p = (id: string, runRate: number, currentStock: number, valueKes: number) => ({ id, runRate, currentStock, valueKes });

describe("selectSpotChecks", () => {
  it("picks the highest-value moving SKUs, up to count", () => {
    const picks = selectSpotChecks(
      [p("a", 1, 10, 100), p("b", 2, 5, 900), p("c", 0.5, 3, 500)],
      2
    );
    expect(picks.map((x) => x.id)).toEqual(["b", "c"]);
  });

  it("excludes dead (no run rate) and empty (no stock) SKUs", () => {
    const picks = selectSpotChecks([p("dead", 0, 10, 999), p("empty", 5, 0, 999), p("ok", 1, 1, 10)]);
    expect(picks.map((x) => x.id)).toEqual(["ok"]);
  });

  it("is deterministic on value ties (runRate then id)", () => {
    const picks = selectSpotChecks([p("y", 1, 1, 100), p("x", 1, 1, 100)], 2);
    expect(picks.map((x) => x.id)).toEqual(["x", "y"]);
  });
});
