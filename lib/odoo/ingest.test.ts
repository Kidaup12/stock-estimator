import { describe, it, expect } from "vitest";
import { productWriteData } from "./ingest";

describe("productWriteData", () => {
  it("omits costKes from the update set when mapped cost is null", () => {
    const d = productWriteData({ externalId: "1", sku: "S", title: "T", costKes: null, priceKes: 100 });
    expect("costKes" in d.update).toBe(false);
    expect(d.update.priceKes).toBe(100);
  });
  it("includes costKes when present", () => {
    const d = productWriteData({ externalId: "1", sku: "S", title: "T", costKes: 250, priceKes: 100 });
    expect(d.update.costKes).toBe(250);
    expect(d.create.costKes).toBe(250);
  });
  it("create defaults costKes to 0 when null (schema default)", () => {
    const d = productWriteData({ externalId: "1", sku: "S", title: "T", costKes: null, priceKes: 100 });
    expect(d.create.costKes).toBe(0);
  });
  it("create carries source=odoo + externalId", () => {
    const d = productWriteData({ externalId: "42", sku: "S", title: "T", costKes: 5, priceKes: 9 });
    expect(d.create.source).toBe("odoo");
    expect(d.create.externalId).toBe("42");
  });
});
