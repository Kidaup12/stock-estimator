import { NextResponse } from "next/server";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { syncOdooTenant } from "@/lib/odoo/sync";

// Ingest + stock + re-forecast can run long on a big catalog.
export const maxDuration = 300;

/** POST /api/odoo/sync — pull the tenant's Odoo data now (OWNER only). */
export async function POST() {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  if (auth.membership.role !== "OWNER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const r = await syncOdooTenant(tenant.id);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message });
  }
}
