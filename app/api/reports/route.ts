import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { redactMoney } from "@/lib/auth/money-visibility";

export async function GET() {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

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

  // Monthly revenue & qty for last 13 months (revenue-only — gross profit dropped per Dave: cross-channel cost untrusted)
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

  // By category — revenue only (last 30d)
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

  // By brand — revenue only
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

  // By supplier — capital tied up AT COST (what we actually paid)
  const bySupplierMap = new Map<string, { revenue: number; stockCost: number; stockRetail: number; count: number; leadAvg: number; country: string | null }>();
  for (const p of products) {
    if (!p.supplierId) continue;
    const sup = supplierById.get(p.supplierId);
    if (!sup) continue;
    const s = sales30Map.get(p.id);
    const existing = bySupplierMap.get(sup.name) || { revenue: 0, stockCost: 0, stockRetail: 0, count: 0, leadAvg: sup.leadTimeAvgDays, country: sup.country };
    existing.revenue += s?.rev ?? 0;
    existing.stockCost += p.currentStock * p.costKes;
    existing.stockRetail += p.currentStock * p.priceKes;
    existing.count += 1;
    bySupplierMap.set(sup.name, existing);
  }
  const bySupplier = Array.from(bySupplierMap.entries())
    .map(([name, v]) => ({ name, ...v, stockValue: v.stockCost }))
    .sort((a, b) => b.stockCost - a.stockCost);

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

  // Top slow movers: high stock × no sales in 90d (capital tied up at COST)
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
      stockValue: p.currentStock * p.costKes, // at cost
      stockRetail: p.currentStock * p.priceKes,
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

  // Lost sales estimate: for critical-urgency predictions, revenue we'd miss if we let them stock out for the next 7 days.
  let lostRevenueKes = 0;
  for (const pred of predictions) {
    if (pred.urgency !== "critical") continue;
    const p = productById.get(pred.productId);
    if (!p) continue;
    const dailyForecast = pred.finalForecast30d / 30;
    const daysLost = Math.max(0, 7 - pred.daysUntilStockout);
    const unitsAtRisk = dailyForecast * daysLost * 0.33; // discount: not every shopper walks
    lostRevenueKes += unitsAtRisk * p.priceKes;
  }

  // Totals at cost (capital tied up) and at retail (sell-through value)
  const totalStockCost = products.reduce((s, p) => s + p.currentStock * p.costKes, 0);
  const totalStockRetail = products.reduce((s, p) => s + p.currentStock * p.priceKes, 0);

  return NextResponse.json(redactMoney({
    monthly,
    byCategory,
    byBrand,
    bySupplier,
    topMovers,
    slowMovers,
    abcCounts,
    lostRevenueKes,
    totalStockCost,
    totalStockRetail,
  }, auth.membership.role));
}
