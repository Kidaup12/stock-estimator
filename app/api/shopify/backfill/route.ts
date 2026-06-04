import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { parseBulkJsonl } from "@/lib/shopify/jsonl";
import {
  runBulkQuery,
  ordersBulkQuery,
  productsBulkQuery,
  inventoryBulkQuery,
} from "@/lib/shopify/bulk";
import { cutoverToReal, type RealIngest } from "@/lib/shopify/cutover";
import type {
  ShopifyProductNode,
  ShopifyLocationNode,
  ShopifyOrderNode,
} from "@/lib/shopify/ingest";

// Bulk Operations run server-side + poll; allow a long ceiling.
export const maxDuration = 300;

/**
 * POST /api/shopify/backfill
 *   (default)            -> DRY RUN: runs the 3 bulk ops, parses, returns the
 *                           synthetic-vs-real counts. NO writes, NO delete.
 *   ?cutover=confirm     -> destructive: invokes cutoverToReal (guarded clear +
 *                           real insert), returns deleted/inserted counts.
 *
 * Auth note: this app uses the client-credentials grant (see lib/shopify/shopify.ts).
 * The minted Admin token comes from SHOPIFY_API_KEY/SECRET at runtime, so the
 * route does NOT decrypt a stored token — it only needs the tenant's shopDomain
 * from ShopifyConnection. (Deviation from the OAuth-session plan; same outcome.)
 */
export async function POST(req: NextRequest) {
  const ctx = await requireTenantOrResponse();
  if (ctx instanceof NextResponse) return ctx;
  const tenantId = ctx.tenant.id;

  const connection = await prisma.shopifyConnection.findUnique({ where: { tenantId } });
  if (!connection || connection.uninstalledAt) {
    return NextResponse.json({ error: "Shopify not connected for this tenant" }, { status: 400 });
  }
  const shopDomain = connection.shopDomain;

  // SERIALIZED bulk ops (one per shop at a time): inventory -> products -> orders.
  let realData: RealIngest;
  try {
    const inventoryJsonl = await runBulkQuery(shopDomain, inventoryBulkQuery());
    const locations = parseBulkJsonl(inventoryJsonl) as ShopifyLocationNode[];

    const productsJsonl = await runBulkQuery(shopDomain, productsBulkQuery());
    const products = parseBulkJsonl(productsJsonl) as ShopifyProductNode[];

    const ordersJsonl = await runBulkQuery(shopDomain, ordersBulkQuery(365));
    const orders = parseBulkJsonl(ordersJsonl) as ShopifyOrderNode[];

    realData = { products, locations, orders };
  } catch (err) {
    return NextResponse.json(
      { error: "Shopify backfill failed", detail: (err as Error).message },
      { status: 502 }
    );
  }

  const real = {
    products: realData.products.length,
    orders: realData.orders.length,
    locations: realData.locations.length,
    lineItems: realData.orders.reduce((n, o) => n + (o.lineItems?.length ?? 0), 0),
    inventoryLevels: realData.locations.reduce(
      (n, l) => n + (l.inventoryLevels?.length ?? 0),
      0
    ),
  };

  const wantsCutover =
    req.nextUrl.searchParams.get("cutover") === "confirm" ||
    (await req
      .clone()
      .json()
      .then((b) => b?.cutover === "confirm")
      .catch(() => false));

  if (!wantsCutover) {
    // DRY RUN — surface the synthetic counts that WOULD be replaced + real counts.
    const [synProducts, synSales, synPredictions, synOrders] = await Promise.all([
      prisma.product.count({ where: { tenantId } }),
      prisma.salesHistory.count({ where: { tenantId } }),
      prisma.prediction.count({ where: { tenantId } }),
      prisma.order.count({ where: { tenantId } }),
    ]);
    return NextResponse.json({
      dryRun: true,
      message:
        `This will REPLACE ${synProducts} synthetic products (+ ${synSales} sales, ` +
        `${synPredictions} predictions, ${synOrders} orders) with ${real.products} real ` +
        `products and ${real.orders} orders from Shopify. Suppliers, promos, and monthly ` +
        `context are preserved. POST ?cutover=confirm to proceed.`,
      synthetic: {
        products: synProducts,
        salesHistory: synSales,
        predictions: synPredictions,
        orders: synOrders,
      },
      real,
    });
  }

  // CONFIRMED — destructive cutover lives in lib/shopify/cutover.ts.
  const result = await cutoverToReal(tenantId, realData, { confirm: true });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  const productCount = await prisma.product.count({ where: { tenantId } });
  return NextResponse.json({ ok: true, cutover: result, productCount });
}
