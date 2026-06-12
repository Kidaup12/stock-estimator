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

  // ?mode=sync -> hourly: refresh products/stock/sales only (fast, light).
  // ?mode=full -> sync + re-forecast (default; the 6-hourly/nightly run).
  const mode = req.nextUrl.searchParams.get("mode") === "sync" ? "sync" : "full";

  const tenants = await prisma.shopifyConnection.findMany({
    where: { uninstalledAt: null },
    select: { tenantId: true },
  });

  const results: Array<{ tenantId: string; ok: boolean; detail?: unknown }> = [];
  for (const t of tenants) {
    try {
      const r = await reconcileTenant(t.tenantId, undefined, { skipForecast: mode === "sync" });
      // Record success so the UI can show "synced X ago" and clear any prior error (G1).
      await prisma.shopifyConnection
        .update({ where: { tenantId: t.tenantId }, data: { lastSyncOkAt: new Date(), lastSyncError: null } })
        .catch(() => {});
      results.push({ tenantId: t.tenantId, ok: true, detail: r });
    } catch (err) {
      const message = (err as Error).message;
      // Persist the failure so the dashboard warns instead of failing silently (G1).
      await prisma.shopifyConnection
        .update({ where: { tenantId: t.tenantId }, data: { lastSyncError: message.slice(0, 500) } })
        .catch(() => {});
      results.push({ tenantId: t.tenantId, ok: false, detail: message });
    }
  }
  return NextResponse.json({ ok: true, mode, tenants: results.length, results });
}
