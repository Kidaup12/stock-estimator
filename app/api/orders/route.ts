import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";

/**
 * Order log for the Orders page.
 *  - active : marked-as-ordered, not yet received (sorted by ETA — soonest first)
 *  - history: received orders, newest first (capped at 200)
 * Order.productId is a bare column (no Prisma relation) → join products manually.
 */
export async function GET() {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const tenantId = auth.tenant.id;

  const select = {
    id: true,
    productId: true,
    orderedQty: true,
    orderedAt: true,
    expectedArrivalAt: true,
    receivedAt: true,
    stockAtOrder: true,
    sawEnroute: true,
  } as const;

  const [active, history] = await Promise.all([
    prisma.order.findMany({
      where: { tenantId, status: "ordered", receivedAt: null, productId: { not: null } },
      select,
      orderBy: { expectedArrivalAt: "asc" },
    }),
    prisma.order.findMany({
      where: { tenantId, status: "received", productId: { not: null } },
      select,
      orderBy: { receivedAt: "desc" },
      take: 200,
    }),
  ]);

  const productIds = [...new Set([...active, ...history].map((o) => o.productId!).filter(Boolean))];
  const products = await prisma.product.findMany({
    where: { tenantId, id: { in: productIds } },
    select: { id: true, title: true, sku: true, vendor: true, importCategory: true, imageUrl: true },
  });
  const pById = new Map(products.map((p) => [p.id, p]));

  const shape = (o: (typeof active)[number]) => ({
    id: o.id,
    productId: o.productId,
    orderedQty: o.orderedQty,
    orderedAt: o.orderedAt,
    expectedArrivalAt: o.expectedArrivalAt,
    receivedAt: o.receivedAt,
    stockAtOrder: o.stockAtOrder,
    sawEnroute: o.sawEnroute,
    product: pById.get(o.productId ?? "") ?? null,
  });

  return NextResponse.json({
    active: active.map(shape),
    history: history.map(shape),
  });
}
