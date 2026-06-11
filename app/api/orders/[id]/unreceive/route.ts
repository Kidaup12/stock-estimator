import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";

/**
 * Reverse a mistaken "Mark received" — the order goes back to on-the-way
 * (status "ordered", receivedAt cleared) so tracking and history stay honest.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  const order = await prisma.order.findFirst({
    where: { id, tenantId: tenant.id, status: "received" },
    select: { id: true },
  });
  if (!order) return NextResponse.json({ error: "Received order not found" }, { status: 404 });

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: "ordered", receivedAt: null },
  });
  return NextResponse.json({ ok: true, order: { id: updated.id, status: updated.status } });
}
