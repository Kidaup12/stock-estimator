/**
 * Pure inventory-position view builder. No Prisma, no Next — the API route fetches
 * rows and hands them here. Run rate is derived from sales over the window (the
 * Product.dailySalesRate field is unset on ingested products, so we do not use it).
 */

export type Abc = "A" | "B" | "C";

export type PositionRowInput = {
  productId: string;
  title: string;
  sku: string;
  abc: Abc | null;
  vendor: string | null;
  supplierName: string | null;
  importCategory: string | null;
  currentStock: number;
  onOrder: number;
  expectedArrivalAt: Date | string | null;
  leadTimeAvgDays: number | null;
  leadTimeStdDays: number | null;
  soldInWindow: number;
  /** On-hand from the snapshot at/just-before the window start, or null if none. */
  snapshotOnHand: number | null;
};

export type PositionInput = {
  windowDays: number;
  rows: PositionRowInput[];
};

export type PositionRow = {
  productId: string;
  title: string;
  sku: string;
  vendor: string | null;
  supplierName: string | null;
  importCategory: string | null;
  runRate: number;
  openingOnHand: number;
  openingEstimated: boolean;
  currentStock: number;
  onOrder: number;
  expectedArrivalAt: string | null;
  leadTimeAvgDays: number | null;
  leadTimeStdDays: number | null;
  daysOfCover: number | null;
};

export type PositionGroup = {
  rows: PositionRow[];
  subtotal: { count: number; opening: number; current: number; enRoute: number };
};

export type PositionView = {
  windowDays: number;
  groups: Record<Abc, PositionGroup>;
};

export function resolveOpening(input: {
  snapshotOnHand: number | null;
  currentStock: number;
  soldInWindow: number;
}): { openingOnHand: number; openingEstimated: boolean } {
  if (input.snapshotOnHand !== null) {
    return { openingOnHand: input.snapshotOnHand, openingEstimated: false };
  }
  return { openingOnHand: input.currentStock + input.soldInWindow, openingEstimated: true };
}

export function daysOfCover(onHand: number, dailyRate: number): number | null {
  if (dailyRate <= 0) return null;
  return onHand / dailyRate;
}

export function buildPositionView(input: PositionInput): PositionView {
  const empty = (): PositionGroup => ({
    rows: [],
    subtotal: { count: 0, opening: 0, current: 0, enRoute: 0 },
  });
  const groups: Record<Abc, PositionGroup> = { A: empty(), B: empty(), C: empty() };

  for (const r of input.rows) {
    const abc: Abc = r.abc === "A" || r.abc === "B" ? r.abc : "C";
    const runRate = input.windowDays > 0 ? r.soldInWindow / input.windowDays : 0;
    const { openingOnHand, openingEstimated } = resolveOpening({
      snapshotOnHand: r.snapshotOnHand,
      currentStock: r.currentStock,
      soldInWindow: r.soldInWindow,
    });
    const eta =
      r.expectedArrivalAt == null
        ? null
        : typeof r.expectedArrivalAt === "string"
          ? r.expectedArrivalAt
          : r.expectedArrivalAt.toISOString();

    const row: PositionRow = {
      productId: r.productId,
      title: r.title,
      sku: r.sku,
      vendor: r.vendor,
      supplierName: r.supplierName,
      importCategory: r.importCategory,
      runRate,
      openingOnHand,
      openingEstimated,
      currentStock: r.currentStock,
      onOrder: r.onOrder,
      expectedArrivalAt: eta,
      leadTimeAvgDays: r.leadTimeAvgDays,
      leadTimeStdDays: r.leadTimeStdDays,
      daysOfCover: daysOfCover(r.currentStock, runRate),
    };

    const g = groups[abc];
    g.rows.push(row);
    g.subtotal.count += 1;
    g.subtotal.opening += openingOnHand;
    g.subtotal.current += r.currentStock;
    g.subtotal.enRoute += r.onOrder;
  }

  // Sort each group by run rate desc (fastest movers first).
  for (const k of ["A", "B", "C"] as const) {
    groups[k].rows.sort((a, b) => b.runRate - a.runRate);
  }

  return { windowDays: input.windowDays, groups };
}
