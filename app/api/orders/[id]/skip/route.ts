import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  const body = await req.json().catch(() => ({}));
  // W1: tenant-scope the order lookup — a foreign/missing order returns 404.
  const order = await prisma.order.findFirst({ where: { id, tenantId: tenant.id } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const updated = await prisma.order.update({
    where: { id },
    data: { status: "skipped", skipReason: body.reason || null },
  });
  return NextResponse.json({ ok: true, order: updated });
}
