import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { z } from "zod";

const schema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  marketingBudget: z.number().optional().nullable(),
  promotions: z.string().optional().nullable(),
  seasonalExpectation: z.string().optional().nullable(),
  cashFlow: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function GET() {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  const contexts = await prisma.monthlyContext.findMany({
    where: { tenantId: tenant.id },
    orderBy: { month: "desc" },
  });
  return NextResponse.json({ contexts });
}

export async function POST(req: NextRequest) {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { month, marketingBudget, promotions, seasonalExpectation, cashFlow, notes } = parsed.data;

  const context = await prisma.monthlyContext.upsert({
    where: { tenantId_month: { tenantId: tenant.id, month } },
    create: {
      tenantId: tenant.id,
      month,
      marketingBudget: marketingBudget ?? null,
      promotions: promotions ?? null,
      seasonalExpectation: seasonalExpectation ?? null,
      cashFlow: cashFlow ?? null,
      notes: notes ?? null,
    },
    update: {
      marketingBudget: marketingBudget ?? null,
      promotions: promotions ?? null,
      seasonalExpectation: seasonalExpectation ?? null,
      cashFlow: cashFlow ?? null,
      notes: notes ?? null,
    },
  });
  return NextResponse.json({ context });
}
