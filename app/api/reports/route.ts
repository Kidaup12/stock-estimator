import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    return NextResponse.json({
      monthly: [],
      byCategory: [],
      byBrand: [],
      bySupplier: [],
      topMovers: [],
      slowMovers: [],
      abcCounts: { A: 0, B: 0, C: 0 },
      lostSalesKes: 0,
    });
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const last30 = new Date(today); last30.setUTCDate(last30.getUTCDate() - 30);
  const last90 = new Date(today); last90.setUTCDate(last90.getUTCDate() - 90);
  const last365 = new Date(today); last365.setUTCFullYear(today.getUTCFullYear() - 1);

  const [products, sales30, sales365, predictions, suppliers] = await Promise.all([
    prisma.product.findMany({ where: { tenantId: tenant.id } }),
    prisma.salesHistory.groupBy({
      by: ["productId"],
      where: { tenantId: tenant.id, date: { gte: last30 } },
      _sum: { quantity: true, revenueKes: true },
    }),
    prisma.salesHistory.findMany({
      where: { tenantId: tenant.id, date: { gte: last365 } },
      select: { productId: true, quantity: true, revenueKes: true, date: true },
    }),
    prisma.prediction.findMany({ where: { tenantId: tenant.id } }),
    prisma.supplier.findMany({ where: { tenantId: tenant.id } }),
  ]);

  const sales30Map = new Map(sales30.map(s => [s.productId, { qty: s._sum.quantity ?? 0, rev: s._sum.revenueKes ?? 0 }]));
  const productById = new Map(products.map(p => [p.id, p]));
  const supplierById = new Map(suppliers.map(s => [s.id, s]));

  // Monthly revenue & qty for last 13 months
  const monthlyMap = new Map<string, { quantity: number; revenueKes: number }>();
  for (const s of sales365) {
    const m = s.date.toISOString().slice(0, 7);
    const e = monthlyMap.get(m) || { quantity: 0, revenueKes: 0 };
    e.quantity += s.quantity;
    e.revenueKes += s.revenueKes;
    monthlyMap.set(m, e);
  }
  const monthly = Array.from(monthlyMap.entries())
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // By category (productType) — 30 day revenue
  const byCategoryMap = new Map<string, { revenue: number; qty: number; count: number }>();
  for (const p of products) {
    const cat = p.productType || "Uncategorised";
    const s = sales30Map.get(p.id);
    const existing = byCategoryMap.get(cat) || { revenue: 0, qty: 0, count: 0 };
    existing.revenue += s?.rev ?? 0;
    existing.qty += s?.qty ?? 0;
    existing.count += 1;
    byCategoryMap.set(cat, existing);
  }
  const byCategory = Array.from(byCategoryMap.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue);

  // By brand (vendor) — top 12
  const byBrandMap = new Map<string, { revenue: number; qty: number; count: number }>();
  for (const p of products) {
    const v = p.vendor || "Unbranded";
    const s = sales30Map.get(p.id);
    const existing = byBrandMap.get(v) || { revenue: 0, qty: 0, count: 0 };
    existing.revenue += s?.rev ?? 0;
    existing.qty += s?.qty ?? 0;
    existing.count += 1;
    byBrandMap.set(v, existing);
  }
  const byBrand = Array.from(byBrandMap.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 12);

  // By supplier — capital exposure (stock value of products) + 30d revenue
  const bySupplierMap = new Map<string, { revenue: number; stockValue: number; count: number; leadAvg: number; country: string | null }>();
  for (const p of products) {
    if (!p.supplierId) continue;
    const sup = supplierById.get(p.supplierId);
    if (!sup) continue;
    const s = sales30Map.get(p.id);
    const existing = bySupplierMap.get(sup.name) || { revenue: 0, stockValue: 0, count: 0, leadAvg: sup.leadTimeAvgDays, country: sup.country };
    existing.revenue += s?.rev ?? 0;
    existing.stockValue += p.currentStock * p.priceKes;
    existing.count += 1;
    bySupplierMap.set(sup.name, existing);
  }
  const bySupplier = Array.from(bySupplierMap.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.stockValue - a.stockValue);

  // Top 10 movers by 30d revenue
  const topMovers = products
    .map(p => {
      const s = sales30Map.get(p.id);
      return {
        id: p.id,
        title: p.title,
        sku: p.sku,
        vendor: p.vendor,
        productType: p.productType,
        revenue30: s?.rev ?? 0,
        qty30: s?.qty ?? 0,
        stock: p.currentStock,
      };
    })
    .sort((a, b) => b.revenue30 - a.revenue30)
    .slice(0, 10);

  // Top slow movers: high stock × no sales in 90d (capital tied up)
  const sold90Set = new Set<string>();
  for (const s of sales365) {
    if (s.date >= last90 && s.quantity > 0) sold90Set.add(s.productId);
  }
  const slowMovers = products
    .filter(p => !sold90Set.has(p.id) && p.currentStock > 0)
    .map(p => ({
      id: p.id,
      title: p.title,
      sku: p.sku,
      vendor: p.vendor,
      productType: p.productType,
      stock: p.currentStock,
      stockValue: p.currentStock * p.priceKes,
    }))
    .sort((a, b) => b.stockValue - a.stockValue)
    .slice(0, 10);

  // ABC counts
  const abcCounts = { A: 0, B: 0, C: 0 };
  for (const p of products) {
    const c = p.abcCategory as "A" | "B" | "C" | null;
    if (c === "A" || c === "B" || c === "C") abcCounts[c]++;
    else abcCounts.C++;
  }

  // Lost sales estimate: for predictions in critical/high urgency, the recommendedQty - 0 = forecast we'd miss if we stocked out.
  // Conservative: assume we lose ~1/3 of forecast over the next 7 days for critical items.
  let lostSalesKes = 0;
  for (const pred of predictions) {
    if (pred.urgency !== "critical") continue;
    const p = productById.get(pred.productId);
    if (!p) continue;
    const dailyForecast = pred.finalForecast30d / 30;
    const daysLost = Math.max(0, 7 - pred.daysUntilStockout);
    lostSalesKes += dailyForecast * daysLost * p.priceKes * 0.33;
  }

  return NextResponse.json({
    monthly,
    byCategory,
    byBrand,
    bySupplier,
    topMovers,
    slowMovers,
    abcCounts,
    lostSalesKes,
  });
}
