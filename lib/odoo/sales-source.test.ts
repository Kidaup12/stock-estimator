import { describe, it, expect, vi } from "vitest";
import { detectAndFetchSales } from "./sales-source";
import type { OdooClient } from "./client";

function clientWith(counts: Record<string, number>, rows: Record<string, unknown[]>): OdooClient {
  return {
    searchCount: vi.fn(async (model: string) => counts[model] ?? 0),
    searchReadAll: vi.fn(async (model: string) => rows[model] ?? []),
  } as unknown as OdooClient;
}

describe("detectAndFetchSales", () => {
  const since = new Date("2026-01-01T00:00:00.000Z");

  it("uses POS when only pos.order.line has rows", async () => {
    const c = clientWith(
      { "pos.order.line": 5, "sale.order.line": 0 },
      { "pos.order.line": [{ product_id: [1, "A"], qty: 2, price_subtotal: 100, create_date: "2026-06-01 10:00:00" }] }
    );
    const r = await detectAndFetchSales(c, since);
    expect(r.source).toBe("pos");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].externalProductId).toBe("1");
  });

  it("uses Sales when only sale.order.line has rows", async () => {
    const c = clientWith(
      { "pos.order.line": 0, "sale.order.line": 9 },
      { "sale.order.line": [{ product_id: [2, "B"], product_uom_qty: 4, price_subtotal: 200, create_date: "2026-06-02 09:00:00" }] }
    );
    const r = await detectAndFetchSales(c, since);
    expect(r.source).toBe("sale");
    expect(r.lines[0].quantity).toBe(4);
  });

  it("merges both when both have rows", async () => {
    const c = clientWith(
      { "pos.order.line": 1, "sale.order.line": 1 },
      {
        "pos.order.line": [{ product_id: [1, "A"], qty: 1, price_subtotal: 50, create_date: "2026-06-01 10:00:00" }],
        "sale.order.line": [{ product_id: [2, "B"], product_uom_qty: 1, price_subtotal: 60, create_date: "2026-06-01 11:00:00" }],
      }
    );
    const r = await detectAndFetchSales(c, since);
    expect(r.source).toBe("both");
    expect(r.lines).toHaveLength(2);
  });

  it("returns none when neither has rows", async () => {
    const c = clientWith({ "pos.order.line": 0, "sale.order.line": 0 }, {});
    const r = await detectAndFetchSales(c, since);
    expect(r.source).toBe("none");
    expect(r.lines).toHaveLength(0);
  });
});
