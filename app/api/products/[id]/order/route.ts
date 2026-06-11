import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { markOrdered } from "@/lib/orders/mark-ordered";

const Body = z.object({ qty: z.number().int().positive().optional() });

/**
 * "Mark as ordered" — single product. Core write lives in lib/orders/mark-ordered.ts
 * (shared with POST /api/orders/bulk).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: productId } = await params;

  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  let raw: unknown = {};
  try { raw = await req.json(); } catch { raw = {}; }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await markOrdered(tenant.id, productId, parsed.data.qty);
  if (!result.ok) {
    return result.reason === "product_not_found"
      ? NextResponse.json({ error: "Product not found" }, { status: 404 })
      : NextResponse.json({ error: "No forecast for this product yet" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, order: { id: result.orderId, orderedQty: result.qty, expectedArrivalAt: result.expectedArrivalAt } });
}
