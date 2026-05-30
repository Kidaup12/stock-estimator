import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";

export async function GET() {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    select: { productType: true, vendor: true },
  });

  const catCounts = new Map<string, number>();
  const brandCounts = new Map<string, number>();
  for (const p of products) {
    const c = (p.productType ?? "").trim();
    if (c) catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
    const b = (p.vendor ?? "").trim();
    if (b) brandCounts.set(b, (brandCounts.get(b) ?? 0) + 1);
  }

  return NextResponse.json({
    categories: Array.from(catCounts.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    brands: Array.from(brandCounts.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  });
}
