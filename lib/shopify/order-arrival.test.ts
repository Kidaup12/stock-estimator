import { describe, it, expect } from "vitest";
import { evaluateOrderArrival } from "./order-arrival";

describe("evaluateOrderArrival", () => {
  const base = { sawEnroute: false, newEnroute: 0, newStock: 0, stockAtOrder: 0, orderedQty: 10 };

  it("stays open right after marking (nothing landed, no en-route yet)", () => {
    const r = evaluateOrderArrival({ ...base, newStock: 0, stockAtOrder: 0 });
    expect(r.received).toBe(false);
    expect(r.sawEnroute).toBe(false);
  });

  it("flags sawEnroute when the product first appears en-route, but does NOT close yet", () => {
    const r = evaluateOrderArrival({ ...base, sawEnroute: false, newEnroute: 8 });
    expect(r.sawEnroute).toBe(true);
    expect(r.received).toBe(false);
  });

  it("closes when en-route was seen on a prior run and is now cleared", () => {
    const r = evaluateOrderArrival({ ...base, sawEnroute: true, newEnroute: 0 });
    expect(r.received).toBe(true);
  });

  it("does NOT close on the same run it first sees en-route (avoids instant close)", () => {
    // sawEnroute came in false; en-route just appeared this run.
    const r = evaluateOrderArrival({ ...base, sawEnroute: false, newEnroute: 5 });
    expect(r.received).toBe(false);
  });

  it("closes when at least half the ordered qty hits the shelf", () => {
    // ordered 10, stock at order 3 → threshold 3 + ceil(5) = 8.
    expect(evaluateOrderArrival({ ...base, orderedQty: 10, stockAtOrder: 3, newStock: 8 }).received).toBe(true);
    expect(evaluateOrderArrival({ ...base, orderedQty: 10, stockAtOrder: 3, newStock: 7 }).received).toBe(false);
  });

  it("uses ceil for the half threshold (odd quantities)", () => {
    // ordered 5 → ceil(2.5) = 3; from 0 stock, need 3 on shelf.
    expect(evaluateOrderArrival({ ...base, orderedQty: 5, stockAtOrder: 0, newStock: 3 }).received).toBe(true);
    expect(evaluateOrderArrival({ ...base, orderedQty: 5, stockAtOrder: 0, newStock: 2 }).received).toBe(false);
  });
});
