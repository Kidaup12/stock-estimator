import { NextResponse } from "next/server";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { generatePurchaseOrders } from "@/lib/po/service";

export async function POST() {
  const ctx = await requireTenantOrResponse();
  if (ctx instanceof NextResponse) return ctx;
  const result = await generatePurchaseOrders(ctx.tenant.id);
  return NextResponse.json(result);
}
