import { PrismaClient } from "@prisma/client";
import { paydayBoost, dayOfWeekMultiplier, holidayBoost } from "../lib/seed/kenya-calendar";

const prisma = new PrismaClient();

function poissonSample(lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  while (p > L) {
    k++;
    p *= Math.random();
  }
  return k - 1;
}

function rankToBaseRate(rank: number, total: number): number {
  // Calibrated for ~6M KES/month aggregate across 1020 SKUs at avg KES 2k price.
  // Long tail intentionally goes near-zero so dead stock emerges naturally.
  const pct = rank / total;
  if (pct < 0.05) return 0.35 + Math.random() * 0.35;
  if (pct < 0.20) return 0.12 + Math.random() * 0.18;
  if (pct < 0.50) return 0.025 + Math.random() * 0.065;
  if (pct < 0.80) return 0.005 + Math.random() * 0.02;
  return Math.random() < 0.5 ? 0 : 0.001 + Math.random() * 0.008;
}

export async function synth() {
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) throw new Error("No tenant — run scrape seed first");

  const products = await prisma.product.findMany({ where: { tenantId: tenant.id } });
  console.log(`Generating sales for ${products.length} products`);

  await prisma.salesHistory.deleteMany({ where: { tenantId: tenant.id } });

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 365);

  const shuffled = [...products].sort(() => Math.random() - 0.5);
  const baseRates = new Map<string, number>();
  shuffled.forEach((p, i) => {
    baseRates.set(p.id, rankToBaseRate(i, shuffled.length));
  });

  const batchSize = 1000;
  let buffer: { tenantId: string; productId: string; date: Date; quantity: number; revenueKes: number; channel: string }[] = [];

  for (const p of products) {
    const base = baseRates.get(p.id) ?? 0.1;
    const promoDates = new Set<string>();
    const numPromos = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numPromos; i++) {
      const offset = Math.floor(Math.random() * 365);
      const len = 2 + Math.floor(Math.random() * 4);
      for (let d = 0; d < len; d++) {
        const dt = new Date(start);
        dt.setUTCDate(dt.getUTCDate() + offset + d);
        promoDates.add(dt.toISOString().slice(0, 10));
      }
    }

    for (let dayOffset = 0; dayOffset < 365; dayOffset++) {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + dayOffset);
      const iso = date.toISOString().slice(0, 10);

      const dow = dayOfWeekMultiplier(date);
      const pay = paydayBoost(date);
      const { boost: hol } = holidayBoost(date, p.productType);
      const promo = promoDates.has(iso) ? 1.5 + Math.random() * 0.5 : 1.0;

      const lambda = base * dow * pay * hol * promo;
      const qty = poissonSample(lambda);
      if (qty <= 0) continue;

      buffer.push({
        tenantId: tenant.id,
        productId: p.id,
        date,
        quantity: qty,
        revenueKes: qty * p.priceKes,
        channel: "shopify",
      });

      if (buffer.length >= batchSize) {
        await prisma.salesHistory.createMany({ data: buffer });
        buffer = [];
      }
    }
  }

  if (buffer.length > 0) {
    await prisma.salesHistory.createMany({ data: buffer });
  }

  const recent30Start = new Date(today);
  recent30Start.setUTCDate(recent30Start.getUTCDate() - 30);
  for (const p of products) {
    const recent = await prisma.salesHistory.aggregate({
      where: { productId: p.id, date: { gte: recent30Start } },
      _sum: { quantity: true },
    });
    const dailyRate = (recent._sum.quantity ?? 0) / 30;
    const expected30 = Math.max(1, dailyRate * 30);

    // Tune currentStock to produce a realistic mix:
    // - some near-stockout (drives reorder + stockout tabs)
    // - some dead stock (catalogue tail with zero sales but units on shelf)
    // - majority comfortable
    let stock: number;
    if (dailyRate === 0) {
      // Dead stock candidate — units sitting on shelf, no movement.
      stock = Math.random() < 0.6 ? Math.floor(8 + Math.random() * 40) : Math.floor(Math.random() * 6);
    } else {
      const r = Math.random();
      if (r < 0.10) {
        stock = Math.floor(expected30 * (0.03 + Math.random() * 0.25));
      } else if (r < 0.30) {
        stock = Math.floor(expected30 * (0.4 + Math.random() * 0.6));
      } else {
        stock = Math.floor(expected30 * (1.6 + Math.random() * 3));
      }
    }

    await prisma.product.update({
      where: { id: p.id },
      data: { dailySalesRate: dailyRate, currentStock: Math.max(0, stock) },
    });
  }

  console.log(`Sales synth done.`);
}

if (require.main === module) {
  synth()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
