/**
 * Tenant-scoped, idempotent upsert mappers from Shopify Bulk-Operation nodes to
 * our Prisma rows. These are the REUSE SEAM: the backfill cutover (Plan 03-03),
 * webhooks (Plan 04), and the nightly reconcile (Plan 05) all call these same
 * mappers, so each is pure — takes a `tenantId` + one normalized Shopify node and
 * performs exactly one upsert.
 *
 * Every query carries `tenantId` (tenant-safety ESLint applies to this file).
 */

import { prisma } from "@/lib/prisma";

// ── Parsed Bulk-Operation node shapes (after parseBulkJsonl reassembly) ───────

export type ShopifyVariantNode = {
  id?: string;
  sku?: string;
  price?: string;
  inventoryItem?: { id?: string };
};

export type ShopifyProductNode = {
  id: string;
  title?: string;
  vendor?: string;
  productType?: string;
  featuredImage?: { url?: string };
  variants?: ShopifyVariantNode[];
};

export type ShopifyLocationNode = {
  id: string;
  name?: string;
  isActive?: boolean;
  inventoryLevels?: Array<{
    id?: string;
    quantities?: Array<{ name: string; quantity: number }>;
    item?: { id?: string; variant?: { id?: string; product?: { id?: string } } };
  }>;
};

export type ShopifyOrderNode = {
  id: string;
  name?: string;
  createdAt?: string;
  lineItems?: Array<{
    quantity?: number;
    sku?: string;
    product?: { id?: string };
    variant?: { id?: string };
    originalUnitPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
  }>;
};

// ── Mappers ──────────────────────────────────────────────────────────────────

/**
 * Upsert a product (+ its first variant's identity/price) keyed on the composite
 * unique (tenantId, shopifyProductId). `currentStock` is the summed on_hand for
 * this product (so the forecast, which reads Product.currentStock, sees reality);
 * pass 0 if inventory isn't known yet. Returns the local product id.
 *
 * Real `productType` is mapped straight through (D-08: real values won't match the
 * kenya-calendar uppercase set — that's a later calibration item, never a crash).
 */
export async function upsertProductFromShopify(
  tenantId: string,
  node: ShopifyProductNode,
  currentStock = 0
): Promise<string> {
  const firstVariant = node.variants?.[0];
  const priceKes = firstVariant?.price ? Number.parseFloat(firstVariant.price) : 0;

  const row = await prisma.product.upsert({
    where: { tenantId_shopifyProductId: { tenantId, shopifyProductId: node.id } },
    create: {
      tenantId,
      shopifyProductId: node.id,
      shopifyVariantId: firstVariant?.id ?? "",
      sku: firstVariant?.sku ?? "",
      title: node.title ?? "(untitled)",
      vendor: node.vendor ?? null,
      productType: node.productType ?? null,
      priceKes: Number.isFinite(priceKes) ? priceKes : 0,
      imageUrl: node.featuredImage?.url ?? null,
      currentStock,
    },
    update: {
      shopifyVariantId: firstVariant?.id ?? "",
      sku: firstVariant?.sku ?? "",
      title: node.title ?? "(untitled)",
      vendor: node.vendor ?? null,
      productType: node.productType ?? null,
      priceKes: Number.isFinite(priceKes) ? priceKes : 0,
      imageUrl: node.featuredImage?.url ?? null,
      currentStock,
      lastSynced: new Date(),
    },
    select: { id: true },
  });
  return row.id;
}

/** Upsert a location keyed on (tenantId, shopifyLocationId). Returns local id. */
export async function upsertLocationFromShopify(
  tenantId: string,
  node: ShopifyLocationNode,
  opts: { isPrimary: boolean }
): Promise<string> {
  const row = await prisma.location.upsert({
    where: { tenantId_shopifyLocationId: { tenantId, shopifyLocationId: node.id } },
    create: {
      tenantId,
      shopifyLocationId: node.id,
      name: node.name ?? "(unnamed)",
      isPrimary: opts.isPrimary,
    },
    update: { name: node.name ?? "(unnamed)", isPrimary: opts.isPrimary },
    select: { id: true },
  });
  return row.id;
}

/** Upsert an on_hand inventory level keyed on (locationId, productId). */
export async function upsertInventoryLevel(
  tenantId: string,
  locationId: string,
  productId: string,
  onHand: number
): Promise<void> {
  await prisma.inventoryLevel.upsert({
    where: { locationId_productId: { locationId, productId } },
    create: { tenantId, locationId, productId, onHand },
    update: { onHand },
  });
}

/**
 * Map an order's line items into SalesHistory rows, one per (product, day),
 * keyed on the unique (productId, date, channel="shopify"). Quantities/revenue
 * for the same product on the same day ACCUMULATE (increment) — correct on a
 * clean slice (the cutover deletes SalesHistory first). Lines whose product is
 * not in our catalog (unresolved gid) are skipped.
 *
 * `productIdByShopifyGid` maps a Shopify product gid -> our local product id.
 */
export async function upsertOrderAsSales(
  tenantId: string,
  orderNode: ShopifyOrderNode,
  productIdByShopifyGid: Map<string, string>
): Promise<number> {
  if (!orderNode.createdAt) return 0;
  // Normalize to UTC midnight of the order day (matches the forecast's day key).
  const day = new Date(orderNode.createdAt.slice(0, 10));

  let written = 0;
  for (const line of orderNode.lineItems ?? []) {
    const gid = line.product?.id;
    if (!gid) continue;
    const productId = productIdByShopifyGid.get(gid);
    if (!productId) continue; // product not ingested — skip

    const qty = line.quantity ?? 0;
    if (qty <= 0) continue;
    const unit = line.originalUnitPriceSet?.shopMoney?.amount
      ? Number.parseFloat(line.originalUnitPriceSet.shopMoney.amount)
      : 0;
    const revenue = Number.isFinite(unit) ? unit * qty : 0;

    await prisma.salesHistory.upsert({
      where: {
        productId_date_channel: { productId, date: day, channel: "shopify" },
      },
      create: { tenantId, productId, date: day, quantity: qty, revenueKes: revenue, channel: "shopify" },
      update: { quantity: { increment: qty }, revenueKes: { increment: revenue } },
    });
    written++;
  }
  return written;
}
