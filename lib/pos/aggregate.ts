/**
 * Aggregate physical Dellwest POS sale lines (already filtered to physical/Completed
 * upstream) into per-(product, tenant-local-day) totals for SalesHistory channel="pos".
 * Match is by SKU (Dellwest line `code` → Product.sku). Lines whose SKU has no Wezesha
 * product are counted + sampled, never invented.
 */
export type PosLineIn = { sku: string; qty: number; subtotal: number };
export type PosSaleIn = { date: Date; lines: PosLineIn[] };

export type PosDayRow = { productId: string; dayKey: string; qty: number; revenue: number };
export type PosAggResult = {
  rows: PosDayRow[];
  matchedLines: number;
  unmatchedLines: number;
  sampleUnmatchedSkus: string[];
};

const norm = (s: string) => (s ?? "").trim().toLowerCase();

export function aggregatePosSales(
  sales: PosSaleIn[],
  skuToProductId: Map<string, string>,
  dayKeyOf: (d: Date) => string
): PosAggResult {
  const acc = new Map<string, PosDayRow>();
  let matchedLines = 0;
  let unmatchedLines = 0;
  const unmatched = new Set<string>();

  for (const sale of sales) {
    const dayKey = dayKeyOf(sale.date);
    for (const line of sale.lines) {
      const key = norm(line.sku);
      const productId = key ? skuToProductId.get(key) : undefined;
      if (!productId) {
        unmatchedLines++;
        if (unmatched.size < 20 && key) unmatched.add((line.sku ?? "").trim());
        continue;
      }
      matchedLines++;
      const k = `${productId}|${dayKey}`;
      const row = acc.get(k);
      if (row) { row.qty += line.qty; row.revenue += line.subtotal; }
      else acc.set(k, { productId, dayKey, qty: line.qty, revenue: line.subtotal });
    }
  }

  return {
    rows: [...acc.values()],
    matchedLines,
    unmatchedLines,
    sampleUnmatchedSkus: [...unmatched].slice(0, 10),
  };
}
