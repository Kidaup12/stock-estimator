import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) return NextResponse.json({ suppliers: [] });
  const suppliers = await prisma.supplier.findMany({
    where: { tenantId: tenant.id },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ suppliers });
}

export async function POST(req: NextRequest) {
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 400 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  const { id, ...data } = parsed.data;

  const supplier = id
    ? await prisma.supplier.update({ where: { id }, data })
    : await prisma.supplier.create({ data: { ...data, tenantId: tenant.id } });
  return NextResponse.json({ supplier });
}
