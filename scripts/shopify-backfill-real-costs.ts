/**
 * One-off: pull REAL cost-per-item (Shopify InventoryItem.unitCost) into
 * Product.costKes for every active product, replacing the earlier margin-guess.
 * Beauty Square's shop currency is KES, so unitCost.amount maps straight to costKes.
 *
 * Idempotent + non-destructive (only updates costKes where Shopify has a cost).
 * Run with the dev server stopped (Supabase pooler cap):
 *   npx tsx scripts/shopify-backfill-real-costs.ts
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { fetchProductsSince } from "../lib/shopify/paginate";
import type { ShopifyProductNode } from "../lib/shopify/ingest";

async function main() {
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) throw new Error("No tenant");
  const domain = process.env.SHOPIFY_SHOP_DOMAIN!;

  // Epoch start => every active product (fetchProductsSince adds status:active).
  const products = (await fetchProductsSince(domain, "2000-01-01")) as ShopifyProductNode[];
  console.log(`Fetched ${products.length} active products from Shopify.`);

  let updated = 0;
  let noCost = 0;
  for (const p of products) {
    const raw = p.variants?.[0]?.inventoryItem?.unitCost?.amount;
    const cost = raw ? Number.parseFloat(raw) : NaN;
    if (!Number.isFinite(cost)) {
      noCost++;
      continue;
    }
    const res = await prisma.product.updateMany({
      where: { tenantId: tenant.id, shopifyProductId: p.id },
      data: { costKes: cost },
    });
    updated += res.count;
  }
  console.log(`Updated costKes on ${updated} products. ${noCost} had no Shopify cost (left as-is).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
