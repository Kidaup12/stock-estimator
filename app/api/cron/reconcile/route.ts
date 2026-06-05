import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reconcileTenant } from "@/lib/shopify/reconcile";

// Paginated reconcile + re-forecast; allow a long ceiling.
export const maxDuration = 300;

/**
 * GET /api/cron/reconcile — system endpoint for the nightly Vercel Cron.
 * Auth: `Authorization: Bearer <CRON_SECRET>` (no user session). Loops every
 * tenant with a live Shopify connection; one tenant's failure does not abort the
 * rest.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tenants = await prisma.shopifyConnection.findMany({
    where: { uninstalledAt: null },
    select: { tenantId: true },
  });

  const results: Array<{ tenantId: string; ok: boolean; detail?: unknown }> = [];
  for (const t of tenants) {
    try {
      const r = await reconcileTenant(t.tenantId);
      results.push({ tenantId: t.tenantId, ok: true, detail: r });
    } catch (err) {
      results.push({ tenantId: t.tenantId, ok: false, detail: (err as Error).message });
    }
  }
  return NextResponse.json({ ok: true, tenants: results.length, results });
}
