import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";

/**
 * Live setup-readiness signals for the active tenant. Drives the status boxes on
 * the Settings page — everything is DERIVED from the tenant's own rows (zero
 * hardcoding), so a brand-new shop shows empty/grey boxes and a configured shop
 * shows its real coverage. Tenant-generic: no shop is special-cased here.
 */
export async function GET() {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  const tenantId = tenant.id;

  const [
    totalProducts,
    withCost,
    mapped,
    withPrediction,
    supplierCount,
    suppliersWithMoq,
    membersCount,
    latestSync,
    latestRun,
    shopifyConnection,
  ] = await Promise.all([
    // Cost coverage is measured over the REAL catalogue (active only) — once the QB
    // feed flags the non-QB products inactive, the dead ~800 drop out of both counts.
    prisma.product.count({ where: { tenantId, active: true } }),
    prisma.product.count({ where: { tenantId, active: true, costKes: { gt: 0 } } }),
    prisma.product.count({ where: { tenantId, supplierId: { not: null } } }),
    prisma.product.count({ where: { tenantId, predictions: { some: {} } } }),
    prisma.supplier.count({ where: { tenantId } }),
    prisma.supplier.count({ where: { tenantId, moq: { gt: 1 } } }),
    prisma.membership.count({ where: { tenantId } }),
    prisma.product.aggregate({ where: { tenantId }, _max: { lastSynced: true } }),
    prisma.prediction.aggregate({ where: { tenantId }, _max: { runDate: true } }),
    prisma.shopifyConnection.findUnique({ where: { tenantId } }),
  ]);

  const shopifyConnected =
    (!!shopifyConnection && !shopifyConnection.uninstalledAt) || !!tenant.shopifyAccessToken;

  return NextResponse.json({
    products: {
      total: totalProducts,
      withCost,
      mapped,
      withPrediction,
    },
    suppliers: { count: supplierCount, withMoq: suppliersWithMoq },
    members: { count: membersCount },
    shopify: {
      connected: shopifyConnected,
      lastSyncAt: totalProducts > 0 ? latestSync._max.lastSynced : null,
      // Sync health (G1): surface the last failed/successful reconcile so the nav
      // badge can warn on a silent failure.
      lastSyncError: shopifyConnection?.lastSyncError ?? null,
      lastSyncOkAt: shopifyConnection?.lastSyncOkAt ?? null,
    },
    // QuickBooks sync is not wired yet — surfaced as a "not connected" box so the
    // UI is complete and lights up automatically once the integration lands.
    quickbooks: { connected: false },
    forecast: { lastRunAt: latestRun._max.runDate ?? null },
  });
}
