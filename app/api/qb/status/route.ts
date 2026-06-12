import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";

/** GET /api/qb/status — last QB catalogue-feed run + current flagged count (Settings card). */
export async function GET() {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  const [last, flaggedNow] = await Promise.all([
    prisma.qbSyncRun.findFirst({ where: { tenantId: tenant.id }, orderBy: { at: "desc" } }),
    prisma.product.count({ where: { tenantId: tenant.id, active: false } }),
  ]);
  return NextResponse.json({ last, flaggedNow });
}
