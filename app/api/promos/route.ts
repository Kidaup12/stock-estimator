import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { z } from "zod";

const schema = z.object({
  id: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  scope: z.enum(["all", "sku", "category", "brand"]),
  scopeValue: z.string().optional().nullable(),
  discountPct: z.number().min(0).max(100),
  promoType: z.enum(["payday", "holiday", "flash", "gwp"]),
  channel: z.enum(["shopify", "whatsapp", "instagram", "all"]),
  notes: z.string().optional().nullable(),
});

export async function GET() {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  const promos = await prisma.promo.findMany({
    where: { tenantId: tenant.id },
    orderBy: { startDate: "desc" },
  });
  return NextResponse.json({ promos });
}

export async function POST(req: NextRequest) {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  const { id, startDate, endDate, ...rest } = parsed.data;

  const data = {
    ...rest,
    startDate: new Date(startDate),
    endDate: new Date(endDate),
  };

  let promo;
  if (id) {
    // Tenant-scope the update: a foreign/missing promo returns 404, never mutates.
    const existing = await prisma.promo.findFirst({ where: { id, tenantId: tenant.id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    promo = await prisma.promo.update({ where: { id }, data });
  } else {
    promo = await prisma.promo.create({ data: { ...data, tenantId: tenant.id } });
  }
  return NextResponse.json({ promo });
}
