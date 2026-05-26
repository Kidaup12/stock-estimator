import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1),
  shopifyDomain: z.string().min(1),
  shopifyAccessToken: z.string().optional().nullable(),
});

export async function GET() {
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) return NextResponse.json(null);
  return NextResponse.json({
    id: tenant.id,
    name: tenant.name,
    shopifyDomain: tenant.shopifyDomain,
    currency: tenant.currency,
    hasToken: !!tenant.shopifyAccessToken,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { name, shopifyDomain, shopifyAccessToken } = parsed.data;

  const existing = await prisma.tenant.findFirst();
  const tenant = existing
    ? await prisma.tenant.update({
        where: { id: existing.id },
        data: { name, shopifyDomain, shopifyAccessToken: shopifyAccessToken || null },
      })
    : await prisma.tenant.create({
        data: { name, shopifyDomain, shopifyAccessToken: shopifyAccessToken || null, currency: "KES" },
      });

  return NextResponse.json({ id: tenant.id, name: tenant.name });
}
