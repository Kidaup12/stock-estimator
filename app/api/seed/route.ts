import { NextResponse } from "next/server";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { seed } from "@/scripts/seed-from-beautysquare";
import { synth } from "@/scripts/synth-sales-history";

export const maxDuration = 300;

export async function POST() {
  // W3: auth-gate the route (401 without session, 403/404 without membership)
  // and write seeded data under the RESOLVED tenant, not a findFirst.
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  try {
    const seedResult = await seed(tenant.id);
    await synth(tenant.id);
    return NextResponse.json({ ok: true, productsSeeded: seedResult.count });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Seed failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
