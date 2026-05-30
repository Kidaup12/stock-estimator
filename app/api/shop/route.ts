import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1),
  shopifyDomain: z.string().min(1),
  shopifyAccessToken: z.string().optional().nullable(),
});

export async function GET() {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  return NextResponse.json({
    id: tenant.id,
    name: tenant.name,
    shopifyDomain: tenant.shopifyDomain,
    currency: tenant.currency,
    hasToken: !!tenant.shopifyAccessToken,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { name, shopifyDomain, shopifyAccessToken } = parsed.data;

  // Update the RESOLVED tenant only — never blind-create a second tenant from a
  // findFirst (the old single-tenant overwrite bug). Tenant CREATION lives in
  // the onboarding flow (Plan 05), NOT here.
  const updated = await prisma.tenant.update({
    where: { id: tenant.id },
    data: { name, shopifyDomain, shopifyAccessToken: shopifyAccessToken || null },
  });

  return NextResponse.json({ id: updated.id, name: updated.name });
}
