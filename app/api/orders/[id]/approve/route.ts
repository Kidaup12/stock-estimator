import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  const result = await prisma.$transaction(async (tx) => {
    // W1: tenant-scope the order lookup — a foreign/missing order returns 404,
    // never approves another tenant's order.
    const order = await tx.order.findFirst({
      where: { id, tenantId: tenant.id },
      include: { prediction: true },
    });
    if (!order) {
      return { kind: "not_found" as const };
    }

    // Idempotency: a re-approve must NOT double-increment onOrder.
    if (order.status === "approved") {
      return { kind: "already_approved" as const, order };
    }

    const qty = Math.max(0, Math.ceil(order.prediction.recommendedQty));

    const updatedOrder = await tx.order.update({
      where: { id },
      data: {
        status: "approved",
        approvedAt: new Date(),
        shopifyDraftOrderId: `mock-draft-${Date.now()}`,
      },
    });

    await tx.product.update({
      where: { id: order.prediction.productId },
      data: { onOrder: { increment: qty } },
    });

    return { kind: "approved" as const, order: updatedOrder, incrementedOnOrderBy: qty };
  });

  if (result.kind === "not_found") {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (result.kind === "already_approved") {
    return NextResponse.json({ ok: true, order: result.order, alreadyApproved: true });
  }
  return NextResponse.json({
    ok: true,
    order: result.order,
    incrementedOnOrderBy: result.incrementedOnOrderBy,
  });
}
