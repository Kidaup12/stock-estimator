/**
 * One-shot manual Odoo sync for a tenant. Usage:
 *   npx tsx scripts/odoo-ingest.ts <tenantSlug> [--since-days=180]
 * Reads OdooConnection (decrypts apiKey), ingests products/sales/suppliers,
 * sets currentStock from stock.quant, then runs forecasts.
 * STOP `npm run dev` first (Supabase pooler connection cap).
 */
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../lib/crypto/encryption";
import { OdooClient } from "../lib/odoo/client";
import { ingestOdooTenant } from "../lib/odoo/ingest";
import { runForecastsForTenant } from "../lib/forecast/run-batch";

const prisma = new PrismaClient();

async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error("usage: tsx scripts/odoo-ingest.ts <tenantSlug> [--since-days=N]");
  const sinceDays = Number(
    process.argv.find((a) => a.startsWith("--since-days="))?.split("=")[1] ?? 180
  );

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, timezone: true },
  });
  if (!tenant) throw new Error(`tenant not found: ${slug}`);
  const conn = await prisma.odooConnection.findUnique({ where: { tenantId: tenant.id } });
  if (!conn) throw new Error(`no OdooConnection for tenant ${slug}`);

  const cfg = {
    baseUrl: conn.baseUrl,
    database: conn.database,
    username: conn.username,
    apiKey: decrypt(conn.apiKey),
  };

  console.log(`[odoo] ingesting ${slug} (since ${sinceDays}d)…`);
  const res = await ingestOdooTenant(tenant.id, cfg, { sinceDays });
  console.log("[odoo] ingest:", res);

  // ── currentStock from stock.quant (sum on_hand across internal locations) ──
  const client = new OdooClient(cfg);
  const quants = await client.searchReadAll<{
    product_id: [number, string] | false;
    quantity: number;
    location_id: [number, string] | false;
  }>("stock.quant", [["location_id.usage", "=", "internal"]], ["product_id", "quantity", "location_id"]);

  const onHandByExternal = new Map<string, number>();
  for (const q of quants) {
    if (!Array.isArray(q.product_id)) continue;
    const ext = String(q.product_id[0]);
    onHandByExternal.set(ext, (onHandByExternal.get(ext) ?? 0) + (q.quantity ?? 0));
  }
  const dbProducts = await prisma.product.findMany({
    where: { tenantId: tenant.id, source: "odoo" },
    select: { id: true, externalId: true },
  });
  for (const p of dbProducts) {
    const stock = onHandByExternal.get(p.externalId!) ?? 0;
    await prisma.product.update({ where: { id: p.id }, data: { currentStock: stock } });
  }
  console.log(`[odoo] currentStock set for ${dbProducts.length} products from ${quants.length} quants`);

  console.log("[odoo] running forecasts…");
  const fc = await runForecastsForTenant(tenant.id, tenant.timezone);
  console.log("[odoo] forecasts:", fc);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
