/**
 * Remove catalog products that are no longer ACTIVE in Shopify.
 *
 * Why: the nightly reconcile originally fetched products without a
 * `status:active` filter, so ~290 draft/archived Shopify products leaked into
 * the catalog (Products page count ≠ Shopify count — Dave, 2026-06-11). The
 * filter exists now; this removes the legacy rows. Deleting a Product cascades
 * its SalesHistory/Predictions/InventoryLevels (drafts have little or none).
 *
 * Guarded: prints what it would delete; pass --yes to actually delete.
 * RUN: npx tsx scripts/cleanup-inactive-products.ts [--yes]
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { fetchProductsSince } from "../lib/shopify/paginate";

async function main() {
  const yes = process.argv.includes("--yes");
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) throw new Error("No tenant");
  const connection = await prisma.shopifyConnection.findUnique({ where: { tenantId: tenant.id } });
  if (!connection || connection.uninstalledAt) throw new Error("No live Shopify connection");

  // All ACTIVE products (since epoch → entire active catalog).
  const active = (await fetchProductsSince(connection.shopDomain, "1970-01-01T00:00:00Z")) as { id: string }[];
  const activeIds = new Set(active.map((p) => String(p.id)));
  console.log(`Shopify active products: ${activeIds.size}`);

  const dbProducts = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, shopifyProductId: true, title: true, currentStock: true },
  });
  console.log(`DB products: ${dbProducts.length}`);

  const stale = dbProducts.filter((p) => !activeIds.has(String(p.shopifyProductId)));
  console.log(`Not active in Shopify (draft/archived/deleted): ${stale.length}`);
  for (const s of stale.slice(0, 25)) console.log(`  ${s.title.slice(0, 60)} (stock ${s.currentStock})`);
  if (stale.length > 25) console.log(`  … and ${stale.length - 25} more`);

  if (!yes) {
    console.log("\nDry run. Re-run with --yes to delete these from the catalog.");
    return;
  }
  const res = await prisma.product.deleteMany({
    where: { tenantId: tenant.id, id: { in: stale.map((s) => s.id) } },
  });
  console.log(`Deleted ${res.count} products (sales history/predictions cascaded).`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
