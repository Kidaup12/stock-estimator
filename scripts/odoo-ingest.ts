/**
 * One-shot manual Odoo sync for a tenant. Usage:
 *   npx tsx scripts/odoo-ingest.ts <tenantSlug> [--since-days=180]
 * Thin wrapper over lib/odoo/sync.ts (the same path the "Sync now" button uses).
 * STOP `npm run dev` first (Supabase pooler connection cap).
 */
import { PrismaClient } from "@prisma/client";
import { syncOdooTenant } from "../lib/odoo/sync";

const prisma = new PrismaClient();

async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error("usage: tsx scripts/odoo-ingest.ts <tenantSlug> [--since-days=N]");
  const sinceDays = Number(process.argv.find((a) => a.startsWith("--since-days="))?.split("=")[1] ?? 180);

  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) throw new Error(`tenant not found: ${slug}`);

  console.log(`[odoo] syncing ${slug} (since ${sinceDays}d)…`);
  const r = await syncOdooTenant(tenant.id, { sinceDays });
  console.log("[odoo] done:", JSON.stringify(r, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
