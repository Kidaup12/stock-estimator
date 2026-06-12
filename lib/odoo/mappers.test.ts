import { describe, it, expect } from "vitest";
import { mapProduct, mapSalesLine, mapSupplierInfo, dayKeyUTC } from "./mappers";

describe("odoo mappers", () => {
  it("mapProduct pulls sku=default_code, cost=standard_price, name", () => {
    const p = mapProduct({ id: 42, default_code: "SKU1", name: "Shampoo", standard_price: 250, list_price: 400 });
    expect(p).toEqual({ externalId: "42", sku: "SKU1", title: "Shampoo", costKes: 250, priceKes: 400 });
  });

  it("mapProduct leaves costKes null when standard_price is 0/false (never clobber)", () => {
    expect(mapProduct({ id: 7, default_code: false, name: "X", standard_price: 0, list_price: 0 }).costKes).toBeNull();
  });

  it("mapProduct falls back sku to odoo id when default_code missing", () => {
    expect(mapProduct({ id: 7, default_code: false, name: "X", standard_price: 0, list_price: 0 }).sku).toBe("odoo-7");
  });

  it("mapSalesLine extracts product id, qty, day-bucketed date", () => {
    const line = mapSalesLine({ product_id: [42, "Shampoo"], qty: 3, price_subtotal: 750, order_date: "2026-06-01 14:33:00" });
    expect(line).toEqual({ externalProductId: "42", quantity: 3, revenueKes: 750, date: "2026-06-01T00:00:00.000Z" });
  });

  it("mapSalesLine reads product_uom_qty (sale.order.line) when qty absent", () => {
    const line = mapSalesLine({ product_id: [2, "B"], product_uom_qty: 4, price_subtotal: 200, order_date: "2026-06-02 09:00:00" });
    expect(line?.quantity).toBe(4);
  });

  it("mapSalesLine returns null when product_id is false", () => {
    expect(mapSalesLine({ product_id: false, qty: 1, price_subtotal: 1, order_date: "2026-06-01 00:00:00" })).toBeNull();
  });

  it("dayKeyUTC truncates a datetime to UTC midnight ISO", () => {
    expect(dayKeyUTC("2026-06-01 14:33:00")).toBe("2026-06-01T00:00:00.000Z");
  });

  it("mapSupplierInfo reads partner name + lead-time delay", () => {
    expect(mapSupplierInfo({ partner_id: [5, "Guangzhou Co"], delay: 21, product_tmpl_id: [9, "X"] })).toEqual({
      supplierName: "Guangzhou Co",
      leadTimeDays: 21,
      productTmplId: "9",
    });
  });
});
