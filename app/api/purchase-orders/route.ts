import { NextResponse } from "next/server";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { listPurchaseOrders } from "@/lib/po/service";

export async function GET() {
  const ctx = await requireTenantOrResponse();
  if (ctx instanceof NextResponse) return ctx;
  const pos = await listPurchaseOrders(ctx.tenant.id);
  return NextResponse.json({ purchaseOrders: pos });
}
