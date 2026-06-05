/**
 * Local trigger for the nightly reconcile (run with the dev server stopped —
 * Supabase pooler cap). The production trigger is app/api/cron/reconcile.
 *
 *   npx tsx scripts/shopify-reconcile.ts
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { reconcileTenant } from "../lib/shopify/reconcile";

async function main() {
  const tenants = await prisma.shopifyConnection.findMany({
    where: { uninstalledAt: null },
    select: { tenantId: true },
  });
  for (const t of tenants) {
    const r = await reconcileTenant(t.tenantId);
    console.log(`reconciled ${t.tenantId}:`, JSON.stringify(r));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
