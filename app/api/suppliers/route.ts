import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { z } from "zod";

const schema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  country: z.string().optional().nullable(),
  currency: z.string().default("USD"),
  leadTimeAvgDays: z.number().int().positive(),
  leadTimeStdDays: z.number().int().nonnegative(),
  moq: z.number().int().positive(),
  notes: z.string().optional().nullable(),
});

export async function GET() {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  const suppliers = await prisma.supplier.findMany({
    where: { tenantId: tenant.id },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ suppliers });
}

export async function POST(req: NextRequest) {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  const { id, ...data } = parsed.data;

  let supplier;
  if (id) {
    // Tenant-scope the update: a foreign/missing supplier returns 404, never mutates.
    const existing = await prisma.supplier.findFirst({ where: { id, tenantId: tenant.id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    supplier = await prisma.supplier.update({ where: { id }, data });
  } else {
    supplier = await prisma.supplier.create({ data: { ...data, tenantId: tenant.id } });
  }
  return NextResponse.json({ supplier });
}
