import { PrismaClient } from "@prisma/client";
import { simulateLayeredForecast, type ActivePromo } from "../lib/forecast/simulate-layers";

const prisma = new PrismaClient();

function assignAbc(productsWithRevenue: { id: string; revenue: number }[]): Record<string, string> {
  const sorted = [...productsWithRevenue].sort((a, b) => b.revenue - a.revenue);
  const total = sorted.reduce((s, p) => s + p.revenue, 0);
  let cumulative = 0;
  const map: Record<string, string> = {};
  for (const p of sorted) {
    cumulative += p.revenue;
    const pct = total > 0 ? cumulative / total : 1;
    if (pct <= 0.7) map[p.id] = "A";
    else if (pct <= 0.9) map[p.id] = "B";
    else map[p.id] = "C";
  }
  return map;
}

async function main() {
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) throw new Error("No tenant — seed first");

  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    include: { supplier: true },
  });
  console.log(`Generating forecasts for ${products.length} products`);

  const today = new Date();
  const since = new Date(today);
  since.setUTCFullYear(today.getUTCFullYear() - 1);

  const allHistory = await prisma.salesHistory.findMany({
    where: { tenantId: tenant.id, date: { gte: since } },
  });
  const historyByProduct = new Map<string, { date: Date; quantity: number }[]>();
  for (const h of allHistory) {
    if (!historyByProduct.has(h.productId)) historyByProduct.set(h.productId, []);
    historyByProduct.get(h.productId)!.push({ date: h.date, quantity: h.quantity });
  }

  const revenueByProduct = products.map(p => {
    const hist = historyByProduct.get(p.id) ?? [];
    const last90 = new Date(today);
    last90.setUTCDate(last90.getUTCDate() - 90);
    const recent = hist.filter(h => h.date >= last90);
    const revenue = recent.reduce((s, h) => s + h.quantity * p.priceKes, 0);
    return { id: p.id, revenue };
  });
  const abcMap = assignAbc(revenueByProduct);

  const activePromos = await prisma.promo.findMany({
    where: {
      tenantId: tenant.id,
      startDate: { lte: new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000) },
      endDate: { gte: today },
    },
  });
  const promosShaped: ActivePromo[] = activePromos.map(p => ({
    discountPct: p.discountPct,
    promoType: p.promoType,
    channel: p.channel,
    scope: p.scope,
    scopeValue: p.scopeValue,
  }));

  await prisma.prediction.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.order.deleteMany({ where: { tenantId: tenant.id } });

  let created = 0;
  for (const p of products) {
    const history = historyByProduct.get(p.id) ?? [];
    const supplier = p.supplier;
    const leadAvg = supplier?.leadTimeAvgDays ?? 30;
    const leadStd = supplier?.leadTimeStdDays ?? 7;
    const abc = abcMap[p.id] ?? "C";

    const result = simulateLayeredForecast({
      productId: p.id,
      productType: p.productType,
      vendor: p.vendor,
      sku: p.sku,
      currentStock: p.currentStock,
      abcCategory: abc,
      history,
      leadTimeAvg: leadAvg,
      leadTimeStd: leadStd,
      activePromos: promosShaped,
    });

    await prisma.product.update({ where: { id: p.id }, data: { abcCategory: abc } });

    const prediction = await prisma.prediction.create({
      data: {
        tenantId: tenant.id,
        productId: p.id,
        layer1Forecast30d: result.layer1Forecast30d,
        layer1Confidence: result.layer1Confidence,
        layer2Adjustment: result.layer2Adjustment,
        finalForecast30d: result.finalForecast30d,
        daysUntilStockout: result.daysUntilStockout,
        recommendedQty: result.recommendedQty,
        safetyStock: result.safetyStock,
        reorderPoint: result.reorderPoint,
        confidence: result.confidence,
        reasoning: result.reasoning,
        urgency: result.urgency,
        signals: JSON.stringify(result.signals),
      },
    });

    if (result.recommendedQty > 0 && (result.urgency === "critical" || result.urgency === "high")) {
      await prisma.order.create({
        data: { tenantId: tenant.id, predictionId: prediction.id, status: "pending" },
      });
    }

    created++;
    if (created % 100 === 0) console.log(`  ${created} / ${products.length}`);
  }

  console.log(`Done. ${created} forecasts created.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
