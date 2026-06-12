/**
 * One call that fully syncs an Odoo tenant: ingest (products/sales/suppliers) →
 * set currentStock from stock.quant → re-forecast. Shared by the manual script
 * (scripts/odoo-ingest.ts) and the "Sync now" button (/api/odoo/sync).
 */
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto/encryption";
import { OdooClient } from "./client";
import { ingestOdooTenant, type OdooIngestResult } from "./ingest";
import { runForecastsForTenant } from "@/lib/forecast/run-batch";

export type OdooSyncResult = {
  ingest: OdooIngestResult;
  productsStocked: number;
  quants: number;
  forecastsCreated: number;
};

export async function syncOdooTenant(tenantId: string, opts: { sinceDays?: number } = {}): Promise<OdooSyncResult> {
  // eslint-disable-next-line tenant-safety/require-tenant-scope -- by-id fetch of the tenant being synced (caller already authed)
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, timezone: true } });
  if (!tenant) throw new Error(`tenant not found: ${tenantId}`);
  const conn = await prisma.odooConnection.findUnique({ where: { tenantId } });
  if (!conn) throw new Error("no OdooConnection for this tenant");

  const cfg = { baseUrl: conn.baseUrl, database: conn.database, username: conn.username, apiKey: decrypt(conn.apiKey) };

  const ingest = await ingestOdooTenant(tenantId, cfg, { sinceDays: opts.sinceDays ?? 180 });

  // currentStock = sum of on_hand across internal locations (stock.quant).
  const client = new OdooClient(cfg);
  const quants = await client.searchReadAll<{ product_id: [number, string] | false; quantity: number }>(
    "stock.quant",
    [["location_id.usage", "=", "internal"]],
    ["product_id", "quantity", "location_id"]
  );
  const onHand = new Map<string, number>();
  for (const q of quants) {
    if (!Array.isArray(q.product_id)) continue;
    const ext = String(q.product_id[0]);
    onHand.set(ext, (onHand.get(ext) ?? 0) + (q.quantity ?? 0));
  }
  const dbProducts = await prisma.product.findMany({
    where: { tenantId, source: "odoo" },
    select: { id: true, externalId: true },
  });
  for (const p of dbProducts) {
    await prisma.product.update({ where: { id: p.id }, data: { currentStock: onHand.get(p.externalId!) ?? 0 } });
  }

  const fc = await runForecastsForTenant(tenantId, tenant.timezone);
  return { ingest, productsStocked: dbProducts.length, quants: quants.length, forecastsCreated: fc.created };
}
