import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { selectSpotChecks } from "@/lib/spotcheck/select";

/** ISO week key, e.g. "2026-W24". */
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // nearest Thursday
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * GET /api/spot-check — this week's 5 SKUs to physically count (G8). Creates the
 * week's set on first call (snapshotting the system on-hand), then returns it
 * joined with product info + any counts already entered.
 */
export async function GET() {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  const weekKey = isoWeekKey(new Date());

  let rows = await prisma.spotCheck.findMany({ where: { tenantId: tenant.id, weekKey } });

  if (rows.length === 0) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const last30 = new Date(today);
    last30.setUTCDate(today.getUTCDate() - 30);
    const [products, sales30] = await Promise.all([
      prisma.product.findMany({ where: { tenantId: tenant.id }, select: { id: true, currentStock: true, priceKes: true } }),
      prisma.salesHistory.groupBy({ by: ["productId"], where: { tenantId: tenant.id, date: { gte: last30 } }, _sum: { quantity: true } }),
    ]);
    const s30 = new Map(sales30.map((s) => [s.productId, s._sum.quantity ?? 0]));
    const picks = selectSpotChecks(
      products.map((p) => ({
        id: p.id,
        runRate: (s30.get(p.id) ?? 0) / 30,
        currentStock: p.currentStock,
        valueKes: p.currentStock * p.priceKes,
      }))
    );
    if (picks.length > 0) {
      await prisma.spotCheck.createMany({
        data: picks.map((p) => ({ tenantId: tenant.id, productId: p.id, weekKey, systemQty: p.currentStock })),
      });
      rows = await prisma.spotCheck.findMany({ where: { tenantId: tenant.id, weekKey } });
    }
  }

  const productIds = rows.map((r) => r.productId);
  const prods = await prisma.product.findMany({
    where: { tenantId: tenant.id, id: { in: productIds } },
    select: { id: true, sku: true, title: true, currentStock: true },
  });
  const byId = new Map(prods.map((p) => [p.id, p]));

  return NextResponse.json({
    weekKey,
    items: rows.map((r) => {
      const p = byId.get(r.productId);
      return {
        id: r.id,
        productId: r.productId,
        sku: p?.sku ?? "",
        title: p?.title ?? "(removed)",
        systemQty: r.systemQty,
        currentStock: p?.currentStock ?? null,
        countedQty: r.countedQty,
        drift: r.countedQty != null ? r.countedQty - r.systemQty : null,
      };
    }),
  });
}

/** POST /api/spot-check { productId, countedQty } — record a physical count. */
export async function POST(req: NextRequest) {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  const body = await req.json().catch(() => ({}));
  const productId = typeof body.productId === "string" ? body.productId : null;
  const countedQty = Number(body.countedQty);
  if (!productId || !Number.isFinite(countedQty)) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const weekKey = isoWeekKey(new Date());
  await prisma.spotCheck.updateMany({
    where: { tenantId: tenant.id, weekKey, productId },
    data: { countedQty, countedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
