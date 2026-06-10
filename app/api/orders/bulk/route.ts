import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { markOrdered } from "@/lib/orders/mark-ordered";

const Body = z.object({
  items: z
    .array(z.object({ productId: z.string().min(1), qty: z.number().int().positive().optional() }))
    .min(1)
    .max(500),
});

/**
 * Bulk "mark as ordered" — used by the Restock Planner's "Mark all as ordered".
 * Same core write as the single-product route (lib/orders/mark-ordered.ts);
 * idempotent per product. Partial success is reported, not failed.
 */
export async function POST(req: NextRequest) {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  let raw: unknown = {};
  try { raw = await req.json(); } catch { raw = {}; }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  let ordered = 0;
  const failed: { productId: string; reason: string }[] = [];
  for (const item of parsed.data.items) {
    const res = await markOrdered(tenant.id, item.productId, item.qty ?? null);
    if (res.ok) ordered++;
    else failed.push({ productId: item.productId, reason: res.reason });
  }

  return NextResponse.json({ ok: true, ordered, failed });
}
