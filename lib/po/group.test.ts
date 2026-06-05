import { describe, it, expect } from "vitest";
import { groupOrdersIntoPos, formatPoNumber, type ApprovedOrderRow } from "./group";

const rows: ApprovedOrderRow[] = [
  { orderId: "o1", supplierId: "s1", productId: "p1", sku: "A1", title: "Item 1", quantity: 10, unitCostKes: 100 },
  { orderId: "o2", supplierId: "s1", productId: "p2", sku: "A2", title: "Item 2", quantity: 5,  unitCostKes: 200 },
  { orderId: "o3", supplierId: "s2", productId: "p3", sku: "B1", title: "Item 3", quantity: 3,  unitCostKes: 50 },
  { orderId: "o4", supplierId: null, productId: "p4", sku: "C1", title: "Item 4", quantity: 7,  unitCostKes: 10 }, // no supplier — skipped
];

describe("groupOrdersIntoPos", () => {
  it("groups by supplier, sums line + subtotal, links order ids", () => {
    const pos = groupOrdersIntoPos(rows);
    const s1 = pos.find((p) => p.supplierId === "s1")!;
    expect(s1.lines).toHaveLength(2);
    expect(s1.subtotalKes).toBe(10 * 100 + 5 * 200); // 2000
    expect(s1.orderIds.sort()).toEqual(["o1", "o2"]);
    expect(s1.lines[0]).toMatchObject({ productId: "p1", sku: "A1", quantity: 10, unitCostKes: 100, lineTotalKes: 1000 });
  });

  it("creates one PO per supplier", () => {
    const pos = groupOrdersIntoPos(rows);
    expect(pos.map((p) => p.supplierId).sort()).toEqual(["s1", "s2"]);
  });

  it("skips rows with no supplier (cannot PO without a vendor)", () => {
    const pos = groupOrdersIntoPos(rows);
    expect(pos.flatMap((p) => p.lines).some((l) => l.productId === "p4")).toBe(false);
  });

  it("skips non-positive quantities", () => {
    const pos = groupOrdersIntoPos([{ orderId: "x", supplierId: "s9", productId: "p9", sku: "Z", title: "Z", quantity: 0, unitCostKes: 5 }]);
    expect(pos).toHaveLength(0);
  });
});

describe("formatPoNumber", () => {
  it("zero-pads a 4-digit sequence with a date prefix", () => {
    expect(formatPoNumber(1, new Date("2026-06-05T00:00:00Z"))).toBe("PO-20260605-0001");
    expect(formatPoNumber(42, new Date("2026-06-05T00:00:00Z"))).toBe("PO-20260605-0042");
  });
});
