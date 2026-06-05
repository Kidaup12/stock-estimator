/** Pure grouping of approved reorder orders into per-supplier PO drafts. No I/O. */

export type ApprovedOrderRow = {
  orderId: string;
  supplierId: string | null;
  productId: string;
  sku: string;
  title: string;
  quantity: number;
  unitCostKes: number;
};

export type PoLineDraft = {
  productId: string;
  sku: string;
  title: string;
  quantity: number;
  unitCostKes: number;
  lineTotalKes: number;
};

export type PoDraft = {
  supplierId: string;
  lines: PoLineDraft[];
  subtotalKes: number;
  orderIds: string[];
};

export function groupOrdersIntoPos(rows: ApprovedOrderRow[]): PoDraft[] {
  const bySupplier = new Map<string, PoDraft>();
  for (const r of rows) {
    if (!r.supplierId) continue; // cannot raise a PO without a vendor
    if (r.quantity <= 0) continue;
    const lineTotalKes = r.quantity * r.unitCostKes;
    let po = bySupplier.get(r.supplierId);
    if (!po) {
      po = { supplierId: r.supplierId, lines: [], subtotalKes: 0, orderIds: [] };
      bySupplier.set(r.supplierId, po);
    }
    po.lines.push({ productId: r.productId, sku: r.sku, title: r.title, quantity: r.quantity, unitCostKes: r.unitCostKes, lineTotalKes });
    po.subtotalKes += lineTotalKes;
    po.orderIds.push(r.orderId);
  }
  return [...bySupplier.values()];
}

export function formatPoNumber(seq: number, date: Date): string {
  const ymd = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
  return `PO-${ymd}-${String(seq).padStart(4, "0")}`;
}
