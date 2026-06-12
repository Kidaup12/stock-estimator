import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { latestForecastRunId } from "@/lib/forecast/latest-run";
import { canSeeMoney } from "@/lib/auth/money-visibility";

/** CSV-escape a value (quote + double internal quotes). */
function csv(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * GET /api/forecast/export?tab=reorder — the reorder list as a CSV download.
 * Mirrors the dashboard's reorder filter so the team can act on / send the list
 * without app-generated POs.
 */
export async function GET(req: NextRequest) {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  const owner = canSeeMoney(auth.membership.role); // MEMBER: no cost column (Dave §7)
  const tab = req.nextUrl.searchParams.get("tab") ?? "reorder";

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const last30Start = new Date(today);
  last30Start.setUTCDate(last30Start.getUTCDate() - 30);

  const runId = await latestForecastRunId(tenant.id);

  const [predictions, sales30] = await Promise.all([
    runId
      ? prisma.prediction.findMany({
          where: { tenantId: tenant.id, forecastRunId: runId },
          include: { product: true },
          orderBy: { daysUntilStockout: "asc" },
        })
      : Promise.resolve([]),
    prisma.salesHistory.groupBy({
      by: ["productId"],
      where: { tenantId: tenant.id, date: { gte: last30Start } },
      _sum: { quantity: true },
    }),
  ]);
  const s30 = new Map(sales30.map((s) => [s.productId, s._sum.quantity ?? 0]));

  const rows = predictions
    .filter((p) => {
      if (tab === "all") return true;
      // reorder: recommend > 0, has stock, and 3 ≤ days-left < 30 (dashboard parity)
      return (
        p.recommendedQty > 0 &&
        p.product.currentStock > 0 &&
        p.daysUntilStockout >= 3 &&
        p.daysUntilStockout < 30
      );
    })
    .map((p) => {
      const runRate = Math.round(((s30.get(p.productId) ?? 0) / 30) * 100) / 100;
      const eta = p.product.expectedArrivalAt
        ? new Date(p.product.expectedArrivalAt).toISOString().slice(0, 10)
        : "";
      return [
        p.product.sku,
        p.product.title,
        p.product.vendor ?? "",
        runRate,
        Math.round(p.product.currentStock),
        p.product.onOrder,
        eta,
        p.daysUntilStockout,
        p.recommendedQty,
        ...(owner ? [Math.round(p.recommendedQty * p.product.costKes)] : []),
        p.product.leadTimeDays ?? "",
      ].map(csv).join(",");
    });

  const header = [
    "SKU", "Product", "Brand", "Run per day", "Current stock", "En route",
    "En route ETA", "Days left", "Reorder qty",
    ...(owner ? ["Reorder cost (KES)"] : []),
    "Lead time (days)",
  ].join(",");
  const body = [header, ...rows].join("\n");
  const date = today.toISOString().slice(0, 10);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reorder-${date}.csv"`,
    },
  });
}
