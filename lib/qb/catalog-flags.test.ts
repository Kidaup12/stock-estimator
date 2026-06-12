import { describe, it, expect } from "vitest";
import { computeCatalogFlags, type CatalogProduct } from "./catalog-flags";

const p = (over: Partial<CatalogProduct>): CatalogProduct => ({
  id: "p", sku: "S", source: "shopify", active: true, activeOverride: false, ...over,
});

describe("computeCatalogFlags", () => {
  it("activates a product whose SKU is in the QB feed", () => {
    const r = computeCatalogFlags([p({ id: "a", sku: "111" })], ["111"]);
    expect(r.activate).toEqual(["a"]);
    expect(r.deactivate).toEqual([]);
  });

  it("keeps an in-QB product active REGARDLESS of stock (stock plays no role)", () => {
    // No stock field exists in the input — proof that membership alone decides.
    const r = computeCatalogFlags([p({ id: "a", sku: "111" })], ["111"]);
    expect(r.activate).toContain("a");
    expect(r.deactivate).not.toContain("a");
  });

  it("deactivates a Shopify product missing from the feed", () => {
    const r = computeCatalogFlags([p({ id: "a", sku: "999" })], ["111"]);
    expect(r.deactivate).toEqual(["a"]);
  });

  it("never deactivates an owner-pinned product (activeOverride)", () => {
    const r = computeCatalogFlags([p({ id: "a", sku: "999", activeOverride: true })], ["111"]);
    expect(r.deactivate).toEqual([]);
  });

  it("never deactivates a non-shopify product (e.g. odoo) missing from the feed", () => {
    const r = computeCatalogFlags([p({ id: "a", sku: "999", source: "odoo" })], ["111"]);
    expect(r.deactivate).toEqual([]);
  });

  it("matches SKU case-insensitively and trimmed", () => {
    const r = computeCatalogFlags([p({ id: "a", sku: " AbC " })], ["abc"]);
    expect(r.activate).toEqual(["a"]);
  });

  it("ABORTS (no deactivations) when the feed would flag >60% of the Shopify catalogue", () => {
    const prods = [
      p({ id: "a", sku: "1" }), p({ id: "b", sku: "2" }),
      p({ id: "c", sku: "3" }), p({ id: "d", sku: "4" }),
    ];
    // feed has only "1" → 3 of 4 (75%) would be flagged → abort
    const r = computeCatalogFlags(prods, ["1"]);
    expect(r.aborted).toBe(true);
    expect(r.deactivate).toEqual([]);
    expect(r.counts.flagged).toBe(0);
    expect(r.activate).toEqual(["a"]); // matched still reported
  });
});
