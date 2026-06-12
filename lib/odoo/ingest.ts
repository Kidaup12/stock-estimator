/**
 * Odoo ingest: pull via OdooClient, map, and batch-write into tenant-scoped
 * Prisma rows. Mirrors lib/shopify/ingest.ts + reconcile.ts. Tenant-safety
 * ESLint applies: every query carries tenantId.
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { OdooClient, type OdooConfig } from "./client";
import { mapProduct, mapSupplierInfo, type MappedProduct } from "./mappers";
import { detectAndFetchSales } from "./sales-source";

const PRODUCT_FIELDS = ["id", "default_code", "name", "standard_price", "list_price"];

/** Pure: build the upsert payload for one product, guarding the cost-clobber. */
export function productWriteData(p: MappedProduct): {
  update: Prisma.ProductUpdateInput;
  create: Omit<Prisma.ProductUncheckedCreateInput, "tenantId">;
} {
  const update: Prisma.ProductUpdateInput = {
    sku: p.sku,
    title: p.title,
    priceKes: p.priceKes,
    lastSynced: new Date(),
  };
  if (p.costKes !== null) update.costKes = p.costKes;
  const create: Omit<Prisma.ProductUncheckedCreateInput, "tenantId"> = {
    sku: p.sku,
    title: p.title,
    priceKes: p.priceKes,
    costKes: p.costKes ?? 0,
    source: "odoo",
    externalId: p.externalId,
  };
  return { update, create };
}

export type OdooIngestResult = {
  products: number;
  salesSource: string;
  salesRows: number;
  suppliers: number;
};

/** Full sync of one Odoo tenant. `sinceDays` bounds the sales window. */
export async function ingestOdooTenant(
  tenantId: string,
  cfg: OdooConfig,
  opts: { sinceDays?: number } = {}
): Promise<OdooIngestResult> {
  const client = new OdooClient(cfg);
  await client.authenticate();

  // ── Products (variants) ────────────────────────────────────────────────
  const rawProducts = await client.searchReadAll<Parameters<typeof mapProduct>[0]>(
    "product.product",
    [["active", "=", true]],
    PRODUCT_FIELDS
  );
  const mapped = rawProducts.map(mapProduct);
  for (const p of mapped) {
    const { update, create } = productWriteData(p);
    await prisma.product.upsert({
      where: { tenantId_source_externalId: { tenantId, source: "odoo", externalId: p.externalId } },
      update,
      create: { tenantId, ...create },
    });
  }

  // map externalId -> internal product id for sales
  const dbProducts = await prisma.product.findMany({
    where: { tenantId, source: "odoo" },
    select: { id: true, externalId: true },
  });
  const idByExternal = new Map(dbProducts.map((p) => [p.externalId!, p.id]));

  // ── Sales (auto-detect POS vs Sales) ───────────────────────────────────
  const since = new Date(Date.now() - (opts.sinceDays ?? 180) * 86_400_000);
  const sales = await detectAndFetchSales(client, since);
  // Aggregate to (productId, dayISO) SET semantics, then deleteMany+createMany.
  const byKey = new Map<string, { productId: string; date: Date; quantity: number; revenueKes: number }>();
  for (const line of sales.lines) {
    const productId = idByExternal.get(line.externalProductId);
    if (!productId) continue;
    const key = `${productId}|${line.date}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.quantity += line.quantity;
      prev.revenueKes += line.revenueKes;
    } else {
      byKey.set(key, {
        productId,
        date: new Date(line.date),
        quantity: line.quantity,
        revenueKes: line.revenueKes,
      });
    }
  }
  const salesRows = [...byKey.values()];
  if (salesRows.length > 0) {
    const productIds = [...new Set(salesRows.map((s) => s.productId))];
    await prisma.salesHistory.deleteMany({
      where: { tenantId, channel: "odoo", productId: { in: productIds } },
    });
    for (let i = 0; i < salesRows.length; i += 1000) {
      await prisma.salesHistory.createMany({
        data: salesRows.slice(i, i + 1000).map((s) => ({
          tenantId,
          productId: s.productId,
          date: s.date,
          quantity: s.quantity,
          revenueKes: s.revenueKes,
          channel: "odoo",
        })),
      });
    }
  }

  // ── Suppliers (product.supplierinfo) ───────────────────────────────────
  const supplierInfos = await client.searchReadAll<Parameters<typeof mapSupplierInfo>[0]>(
    "product.supplierinfo",
    [],
    ["partner_id", "delay", "product_tmpl_id"]
  );
  const supplierNames = [
    ...new Set(supplierInfos.map(mapSupplierInfo).map((s) => s.supplierName).filter(Boolean)),
  ] as string[];
  for (const name of supplierNames) {
    const existing = await prisma.supplier.findFirst({ where: { tenantId, name } });
    if (!existing) await prisma.supplier.create({ data: { tenantId, name, currency: "KES" } });
  }

  await prisma.odooConnection
    .update({ where: { tenantId }, data: { lastSyncedAt: new Date() } })
    .catch(() => {});

  return {
    products: mapped.length,
    salesSource: sales.source,
    salesRows: salesRows.length,
    suppliers: supplierNames.length,
  };
}
