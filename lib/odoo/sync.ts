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

  // currentStock = Odoo's VIRTUAL available per variant (on_hand + incoming −
  // reserved). The owner counts committed/incoming stock as real (Mary, feedback
  // 2026-06-12), and for restock math incoming legitimately reduces what to reorder.
  // Odoo sync writes ONLY currentStock (onOrder stays 0 here), so there is no
  // double-count with the onOrder subtraction in the forecast.
  // GATE: validate against the live instance before relying on it — the prior
  // on_hand sum showed a ~1,310-vs-9 gap whose root cause (UoM / locations /
  // duplicate variants) may be independent of this field choice.
  const client = new OdooClient(cfg);
  const variants = await client.searchReadAll<{ id: number; virtual_available: number }>(
    "product.product",
    [["active", "=", true]],
    ["id", "virtual_available"]
  );
  const stockByExternal = new Map<string, number>();
  for (const v of variants) {
    stockByExternal.set(String(v.id), v.virtual_available ?? 0);
  }
  const dbProducts = await prisma.product.findMany({
    where: { tenantId, source: "odoo" },
    select: { id: true, externalId: true },
  });
  for (const p of dbProducts) {
    await prisma.product.update({ where: { id: p.id }, data: { currentStock: stockByExternal.get(p.externalId!) ?? 0 } });
  }

  const fc = await runForecastsForTenant(tenantId, tenant.timezone);
  return { ingest, productsStocked: dbProducts.length, quants: variants.length, forecastsCreated: fc.created };
}
