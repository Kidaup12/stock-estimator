import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";

/** Undo a manual "Mark as ordered" — deletes the active marker so the product re-enters reorder. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  const order = await prisma.order.findFirst({
    where: { id, tenantId: tenant.id, status: "ordered", receivedAt: null },
    select: { id: true },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  await prisma.order.delete({ where: { id: order.id } });
  return NextResponse.json({ ok: true });
}
