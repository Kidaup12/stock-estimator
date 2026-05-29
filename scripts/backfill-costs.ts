import { PrismaClient } from "@prisma/client";
import { mulberry32 } from "../lib/forecast/rng";
import { BACKFILL_SEED } from "../lib/forecast/rng-constants";
const prisma = new PrismaClient();

// Cost factor (cost as % of retail price) varies by supplier origin.
// Beauty retail in Kenya: imported premium → low margin; cheap imports → high margin.
const COST_FACTOR_BY_SUPPLIER: Record<string, [number, number]> = {
  "Guangzhou Beauty Imports":  [0.30, 0.40], // 60-70% margin
  "Mombasa Sea Freight":       [0.25, 0.35], // 65-75% margin — bulk staples
  "Dubai Cosmetics House":     [0.50, 0.65], // 35-50% — premium fragrance
  "EU Beauty Direct":          [0.55, 0.70], // 30-45% — premium imports
  "Nairobi Trade Centre":      [0.55, 0.70], // 30-45% — local wholesale markup
  "Eastleigh Distributors":    [0.45, 0.60], // 40-55%
};
const DEFAULT_FACTOR: [number, number] = [0.45, 0.60];

async function main() {
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) throw new Error("No tenant");

  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    include: { supplier: true },
  });

  // Deterministic cost-band sampler per BACKFILL_SEED.
  const rng = mulberry32(BACKFILL_SEED);

  let updated = 0;
  let totalRetail = 0;
  let totalCost = 0;
  for (const p of products) {
    const [lo, hi] = p.supplier ? (COST_FACTOR_BY_SUPPLIER[p.supplier.name] ?? DEFAULT_FACTOR) : DEFAULT_FACTOR;
    const factor = lo + rng() * (hi - lo);
    const cost = Math.round(p.priceKes * factor);
    await prisma.product.update({ where: { id: p.id }, data: { costKes: cost } });
    totalRetail += p.currentStock * p.priceKes;
    totalCost += p.currentStock * cost;
    updated++;
  }

  console.log(`Updated ${updated} products.`);
  console.log(`Stock value at retail: KES ${Math.round(totalRetail).toLocaleString()}`);
  console.log(`Stock value at cost:   KES ${Math.round(totalCost).toLocaleString()}`);
  console.log(`Implied blended margin: ${((1 - totalCost / totalRetail) * 100).toFixed(1)}%`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
