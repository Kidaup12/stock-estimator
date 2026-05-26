import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const updated = await prisma.order.update({
    where: { id },
    data: {
      status: "approved",
      approvedAt: new Date(),
      shopifyDraftOrderId: `mock-draft-${Date.now()}`,
    },
  });
  return NextResponse.json({ ok: true, order: updated });
}
