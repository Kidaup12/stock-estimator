import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";

/**
 * GET /api/shop/test — real, tenant-scoped Shopify connection status.
 *
 * Replaces the old mock Shopify test-connection stub. Reports whether the
 * current tenant has a live ShopifyConnection (installed, not uninstalled). Never
 * decrypts or exposes credentials.
 */
export async function GET() {
  const ctx = await requireTenantOrResponse();
  if (ctx instanceof NextResponse) return ctx;

  const connection = await prisma.shopifyConnection.findUnique({
    where: { tenantId: ctx.tenant.id },
    select: { shopDomain: true, scope: true, installedAt: true, uninstalledAt: true },
  });

  const connected = Boolean(connection && !connection.uninstalledAt);
  return NextResponse.json({
    ok: true,
    connected,
    shopName: connected ? connection!.shopDomain : "not connected",
    scope: connection?.scope ?? null,
  });
}
