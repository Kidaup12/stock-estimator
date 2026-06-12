import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";

/** GET /api/qb/flagged — products soft-flagged as "not in QuickBooks" (active=false),
 *  with the signals an owner needs to decide whether to keep them. Tenant-scoped,
 *  read-only (any member; the review link lives on the owner-only Settings card). */
export async function GET() {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id, active: false },
    select: { id: true, title: true, sku: true, vendor: true, currentStock: true, activeOverride: true },
    orderBy: { title: "asc" },
  });

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 90);
  const sales = await prisma.salesHistory.groupBy({
    by: ["productId"],
    where: { tenantId: tenant.id, date: { gte: since } },
    _sum: { quantity: true },
  });
  const sold90 = new Map(sales.map((s) => [s.productId, s._sum.quantity ?? 0]));

  return NextResponse.json({
    products: products.map((p) => ({ ...p, sold90: sold90.get(p.id) ?? 0 })),
  });
}
