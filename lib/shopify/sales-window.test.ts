import { describe, it, expect } from "vitest";
import { bucketSalesByProductDay } from "./sales-window";
import type { ShopifyOrderNode } from "./ingest";

const gidMap = new Map<string, string>([
  ["gid://shopify/Product/1", "local-1"],
  ["gid://shopify/Product/2", "local-2"],
]);

const orders: ShopifyOrderNode[] = [
  {
    id: "o1", createdAt: "2026-06-04T10:00:00Z",
    lineItems: [
      { quantity: 2, product: { id: "gid://shopify/Product/1" }, originalUnitPriceSet: { shopMoney: { amount: "100" } } },
      { quantity: 1, product: { id: "gid://shopify/Product/2" }, originalUnitPriceSet: { shopMoney: { amount: "50" } } },
    ],
  },
  {
    id: "o2", createdAt: "2026-06-04T18:00:00Z",
    lineItems: [
      { quantity: 3, product: { id: "gid://shopify/Product/1" }, originalUnitPriceSet: { shopMoney: { amount: "100" } } },
    ],
  },
  {
    id: "o3", createdAt: "2026-06-04T12:00:00Z",
    lineItems: [
      { quantity: 5, product: { id: "gid://shopify/Product/99" }, originalUnitPriceSet: { shopMoney: { amount: "10" } } }, // unknown product — skipped
    ],
  },
];

describe("bucketSalesByProductDay", () => {
  it("sums quantity + revenue per (product, day)", () => {
    const buckets = bucketSalesByProductDay(orders, gidMap);
    // product 1, 2026-06-04 => qty 5 (2+3), revenue 500
    const key = "local-1|2026-06-04";
    expect(buckets.get(key)).toEqual({
      productId: "local-1", dateKey: "2026-06-04", quantity: 5, revenueKes: 500,
    });
  });

  it("keeps separate products on the same day separate", () => {
    const buckets = bucketSalesByProductDay(orders, gidMap);
    expect(buckets.get("local-2|2026-06-04")).toEqual({
      productId: "local-2", dateKey: "2026-06-04", quantity: 1, revenueKes: 50,
    });
  });

  it("skips line items whose product is not in the catalog", () => {
    const buckets = bucketSalesByProductDay(orders, gidMap);
    expect([...buckets.keys()].some((k) => k.startsWith("local-99") || k.includes("/99"))).toBe(false);
  });

  it("is pure — running twice yields identical buckets (idempotent input)", () => {
    const a = bucketSalesByProductDay(orders, gidMap);
    const b = bucketSalesByProductDay(orders, gidMap);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });
});
