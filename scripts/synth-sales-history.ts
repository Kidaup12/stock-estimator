import { PrismaClient } from "@prisma/client";
import { paydayBoost, dayOfWeekMultiplier, holidayBoost } from "../lib/seed/kenya-calendar";
import { mulberry32 } from "../lib/forecast/rng";
import { SYNTH_SEED } from "../lib/forecast/rng-constants";

const prisma = new PrismaClient();

type Rng = () => number;

function poissonSample(lambda: number, rng: Rng): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  while (p > L) {
    k++;
    p *= rng();
  }
  return k - 1;
}

function rankToBaseRate(rank: number, total: number, rng: Rng): number {
  // Calibrated for ~6M KES/month aggregate across 1020 SKUs at avg KES 2k price.
  // Long tail intentionally goes near-zero so dead stock emerges naturally.
  const pct = rank / total;
  if (pct < 0.05) return 0.35 + rng() * 0.35;
  if (pct < 0.20) return 0.12 + rng() * 0.18;
  if (pct < 0.50) return 0.025 + rng() * 0.065;
  if (pct < 0.80) return 0.005 + rng() * 0.02;
  return rng() < 0.5 ? 0 : 0.001 + rng() * 0.008;
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

  // Single deterministic RNG seeded per SYNTH_SEED — replaces every Math.random
  // and threaded into top-level helpers (poissonSample, rankToBaseRate) so they
  // do not silently fall back to global randomness (codex REVIEWS #2).
  const rng = mulberry32(SYNTH_SEED);

  // Fisher-Yates shuffle using rng() — replaces the biased sort-comparator
  // pattern (RESEARCH Pitfall #8). Required for cross-V8-version determinism.
  const shuffled = [...products];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const baseRates = new Map<string, number>();
  shuffled.forEach((p, i) => {
    baseRates.set(p.id, rankToBaseRate(i, shuffled.length, rng));
  });

  const batchSize = 1000;
  let buffer: { tenantId: string; productId: string; date: Date; quantity: number; revenueKes: number; channel: string }[] = [];

  for (const p of products) {
    const base = baseRates.get(p.id) ?? 0.1;
    const promoDates = new Set<string>();
    const numPromos = 5 + Math.floor(rng() * 4);
    for (let i = 0; i < numPromos; i++) {
      const offset = Math.floor(rng() * 365);
      const len = 2 + Math.floor(rng() * 4);
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
      const promo = promoDates.has(iso) ? 1.5 + rng() * 0.5 : 1.0;

      const lambda = base * dow * pay * hol * promo;
      const qty = poissonSample(lambda, rng);
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
      stock = rng() < 0.6 ? Math.floor(8 + rng() * 40) : Math.floor(rng() * 6);
    } else {
      const r = rng();
      if (r < 0.10) {
        stock = Math.floor(expected30 * (0.03 + rng() * 0.25));
      } else if (r < 0.30) {
        stock = Math.floor(expected30 * (0.4 + rng() * 0.6));
      } else {
        stock = Math.floor(expected30 * (1.6 + rng() * 3));
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
